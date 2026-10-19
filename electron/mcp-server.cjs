const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomBytes, timingSafeEqual} = require('node:crypto');
const {McpServer} = require('@modelcontextprotocol/sdk/server/mcp.js');
const {StreamableHTTPServerTransport} = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const {z} = require('zod/v4');

const VERSION = '1.0.0';
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_ACTIVE_REQUESTS = 16;
const finite = z.number().finite();
const label = z.string().min(1).max(200).refine(value => value.trim().length > 0, 'Name must not be blank');
const safeStem = z.string().min(1).max(64).regex(/^[\p{L}\p{N}_-]+$/u)
  .refine(value => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value), 'Unsafe filename');
const safeBasename = z.string().min(1).max(74).regex(/^[\p{L}\p{N}_-]{1,64}(?:\.echo\.json|\.png)?$/u)
  .refine(value => safeStem.safeParse(value.replace(/(?:\.echo\.json|\.png)$/, '')).success, 'Unsafe filename');
const caseName = safeBasename.refine(value => !value.endsWith('.png'), 'Case name must use .echo.json');
const templateName = safeBasename.refine(value => !value.endsWith('.echo.json'), 'Template name must use .png');
const templatePath = z.string().max(75).regex(/^assets\/[\p{L}\p{N}_-]{1,64}\.png$/u)
  .refine(value => safeStem.safeParse(value.slice(7,-4)).success, 'Template must be an assets PNG');
const keyNames = new Set(['CTRL','CONTROL','ALT','SHIFT','ENTER','RETURN','ESC','ESCAPE','TAB','SPACE','BACKSPACE','DELETE',
  'LEFT','UP','RIGHT','DOWN','HOME','END','PAGEUP','PAGEDOWN','LCTRL','RCTRL','LSHIFT','RSHIFT','LALT','RALT','CAPSLOCK','INSERT']);
const keys = z.string().min(1).max(80).refine(value => {
  const parts = value.toUpperCase().split('+').map(key => key.trim());
  if (parts.length > 5 || !parts.every(key => keyNames.has(key) || /^[A-Z0-9]$/.test(key) || /^F(?:[1-9]|10|11)$/.test(key))) return false;
  const alt = parts.some(key => ['ALT','LALT','RALT'].includes(key));
  const ctrl = parts.some(key => ['CTRL','CONTROL','LCTRL','RCTRL'].includes(key));
  return !(alt && parts.some(key => ['TAB','F4','ESC','ESCAPE'].includes(key))) && !(ctrl && parts.some(key => ['ESC','ESCAPE'].includes(key)));
}, 'Unsupported or system-reserved key combination');
const selectorSchema = z.object({
  library_id: z.union([z.literal(''),z.string().regex(/^[a-f0-9]{32}$/)]).default(''),
  name: label, kind: z.enum(['coordinate','image']).default('coordinate'),
  x: finite.min(0).max(100000).default(.5), y: finite.min(0).max(100000).default(.5),
  normalized: z.boolean().default(true), image: z.union([z.literal(''), templatePath]).default(''),
  threshold: finite.min(.5).max(1).default(.86),
  scales: z.array(finite.min(.25).max(4)).min(1).max(15).default([1]),
  roi: z.tuple([z.int().min(-100000).max(100000), z.int().min(-100000).max(100000), z.int().min(1).max(100000), z.int().min(1).max(100000)]).nullable().default(null),
  offset_x: z.int().min(-100000).max(100000).default(0), offset_y: z.int().min(-100000).max(100000).default(0),
  recognition: z.enum(['template','ocr']).default('template'),
  templates: z.array(z.object({image:templatePath,mask:z.union([z.literal(''),templatePath]).default('')}).strict()).max(10).default([]),
  mask: z.union([z.literal(''),templatePath]).default(''), anchor:z.string().max(200).default(''),
  text:z.string().max(200).default(''), text_match:z.enum(['exact','contains']).default('exact'),
  color_tolerance:finite.min(0).max(255).nullable().default(null),
}).strict().superRefine((value, ctx) => {
  if (value.kind === 'image' && value.recognition === 'template' && !value.image && !value.templates.length) ctx.addIssue({code:'custom',path:['image'],message:'Image selector needs an assets PNG'});
  if (value.kind === 'image' && value.recognition === 'ocr' && !value.text.trim()) ctx.addIssue({code:'custom',path:['text'],message:'OCR needs target text'});
  if (value.kind === 'image' && value.anchor && !value.roi) ctx.addIssue({code:'custom',path:['roi'],message:'Anchor needs relative ROI'});
  if (!value.anchor && value.roi && (value.roi[0]<0 || value.roi[1]<0)) ctx.addIssue({code:'custom',path:['roi'],message:'Absolute ROI must be nonnegative'});
  if (value.kind === 'coordinate' && value.normalized && (value.x > 1 || value.y > 1)) ctx.addIssue({code:'custom',message:'Normalized coordinates must be in 0..1'});
});
const actionNames = ['click','double_click','right_click','long_press','drag','scroll','wait_image','assert_image','assert_absent',
  'key','text','sleep','screenshot','key_down','key_up','python'];
const paramsSchema = z.object({
  duration: finite.min(.01).max(600).optional(), interval: finite.min(.01).max(600).optional(),
  amount: z.int().min(-100).max(100).refine(value => value !== 0).optional(),
  axis: z.enum(['vertical','horizontal']).optional(), keys: keys.optional(), text: z.string().max(4000).optional(),
  path: z.array(z.tuple([finite.min(0).max(1),finite.min(0).max(1)])).max(5000).optional(),
  button: z.enum(['left','right','middle']).optional(),
  code: z.string().max(256*1024).refine(value=>Buffer.byteLength(value,'utf8')<=256*1024,'Python source exceeds 256 KB').optional(),
}).strict();
const stepSchema = z.object({
  name: label.default('单击控件'), action: z.enum(actionNames).default('click'),
  target: z.string().max(200).default(''), end_target: z.string().max(200).default(''), enabled: z.boolean().default(true),
  timeout: finite.min(.1).max(600).default(5), delay: finite.min(0).max(600).default(.5),
  repeat: z.int().min(1).max(1000).default(1), params: paramsSchema.default({}),
}).strict().superRefine((value, ctx) => {
  if (value.params.path && value.action !== 'drag') ctx.addIssue({code:'custom',path:['params','path'],message:'Only drag supports a path'});
  if(value.action==='python'&&value.enabled&&!value.params.code?.trim())ctx.addIssue({code:'custom',path:['params','code'],message:'Python script must not be blank'});
});
const targetActions = new Set(['click','double_click','right_click','long_press','drag','scroll','wait_image','assert_image','assert_absent']);
const imageActions = new Set(['wait_image','assert_image','assert_absent']);
const projectSchema = z.object({name:label.default('目标应用测试用例'), schema_version:z.literal(1).default(1),
  selectors:z.array(selectorSchema).max(5000).default([]), steps:z.array(stepSchema).max(10000).default([]),
}).strict().superRefine((value, ctx) => {
  const selectors = new Map();
  for (const [index, selector] of value.selectors.entries()) {
    if (selectors.has(selector.name)) ctx.addIssue({code:'custom',path:['selectors',index,'name'],message:'Duplicate selector name'});
    selectors.set(selector.name, selector);
  }
  for (const [index, selector] of value.selectors.entries()) {
    const seen = new Set([selector.name]); let current = selector;
    while (current?.kind === 'image' && current.anchor) {
      const next = selectors.get(current.anchor);
      if (!next || next.kind !== 'image' || seen.has(current.anchor) || seen.size >= 32) {
        ctx.addIssue({code:'custom',path:['selectors',index,'anchor'],message:'Anchor is missing, invalid, cyclic or too deep'}); break;
      }
      seen.add(current.anchor); current = next;
    }
  }
  for (const [index, step] of value.steps.entries()) {
    if (!step.enabled) continue;
    if (targetActions.has(step.action) && !selectors.has(step.target)) ctx.addIssue({code:'custom',path:['steps',index,'target'],message:'Target selector does not exist'});
    if (step.action === 'drag' && !selectors.has(step.end_target)) ctx.addIssue({code:'custom',path:['steps',index,'end_target'],message:'Drag end selector does not exist'});
    if (imageActions.has(step.action) && selectors.get(step.target)?.kind !== 'image') ctx.addIssue({code:'custom',path:['steps',index,'target'],message:'Image action needs an image selector'});
  }
});
// Exploration shares the case model, but runs a bounded fragment without saving it.
const explorationStepSchema=stepSchema.safeExtend({
  action:z.enum(actionNames.filter(action=>action!=='python')).default('click'),
  repeat:z.int().min(1).max(10).default(1),
});
const explorationProjectSchema=projectSchema.safeExtend({steps:z.array(explorationStepSchema).min(1).max(10)});
const explorationSchema = z.object({project:explorationProjectSchema,timeout:finite.min(1).max(30).default(15)}).strict().superRefine((value,ctx)=>{
  const steps=value.project.steps;
  if(steps.filter(step=>step.enabled).reduce((count,step)=>count+step.repeat,0)>10)
    ctx.addIssue({code:'custom',path:['project','steps'],message:'Exploration supports at most 10 steps including repeats'});
  if(!steps.some(step=>step.enabled))ctx.addIssue({code:'custom',path:['project','steps'],message:'Exploration needs an enabled step'});
});
const empty = z.object({}).strict();
const tools = [
  ['echo_test_status', 'Read workbench state, window connection, administrator permission and current run.', empty, true],
  ['echo_test_windows', 'List application windows supported by this workbench.', empty, true],
  ['echo_test_connect', 'Connect a listed application window in native mode. The workbench rejects arbitrary windows.', z.object({handle:z.int().min(1).max(Number.MAX_SAFE_INTEGER)}).strict()],
  ['echo_test_capture', 'Capture the connected application. Returns PNG pixels and a capture id for creating templates.', empty, true],
  ['echo_test_explore', 'Execute an inline project fragment (at most 10 steps including repeats, 1–30 seconds, default 15). Waits for completion and returns step results plus a fresh final PNG and capture_id, including on failure/stop when possible. Saves no case, controls or report and preserves editor changes. F12 or echo_test_stop stops it. Verify screenshot/assertions before saving a formal case. Python scripts require a saved case.', explorationSchema],
  ['echo_test_save_case', 'Validate and save a case under the workbench test_cases directory.', z.object({name:caseName,project:projectSchema}).strict()],
  ['echo_test_load_case', 'Load a saved case by filename within test_cases.', z.object({name:caseName}).strict(), true],
  ['echo_test_run_case', 'Run a validated saved case against the connected application. Poll echo_test_events and echo_test_status for completion; F12 or echo_test_stop stops execution.', z.object({name:caseName,iterations:z.int().min(1).max(10).default(1)}).strict()],
  ['echo_test_stop', 'Stop the running case or recording and release held inputs.', empty],
  ['echo_test_report', 'Read a completed execution report by its report id.', z.object({id:safeStem}).strict(), true],
  ['echo_test_events', 'Read execution events after a sequence number without blocking.', z.object({after:z.int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),limit:z.int().min(1).max(200).default(100)}).strict(), true],
  ['echo_test_save_template', 'Crop an observed capture into an assets PNG template. Coordinates use client-area pixels.', z.object({name:templateName,capture_id:z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),rect:z.object({x:z.int().min(0).max(100000),y:z.int().min(0).max(100000),w:z.int().min(4).max(100000),h:z.int().min(4).max(100000)}).strict()}).strict()],
  ['echo_test_preview_target', 'Preview recognition, including candidates on misses. Supply selectors for named anchors. Does not send input.', z.object({selector:selectorSchema,selectors:z.array(selectorSchema).max(5000).optional()}).strict(), true],
  ['echo_test_record_start', 'Start recording inputs in the connected application. F12 stops recording.', empty],
  ['echo_test_record_stop', 'Stop recording and return the pending recorded case for review.', empty],
];

function jsonResult(value) {
  const output = value && typeof value === 'object' && !Array.isArray(value) ? value : {result:value ?? null};
  return {content:[{type:'text',text:JSON.stringify(output)}],structuredContent:output};
}

function imageResult(value) {
  if (!value || typeof value.image !== 'string') throw new Error('Capture did not return image pixels');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(value.image);
  const mimeType = match?.[1] || value.mimeType || 'image/png';
  const data = match?.[2] || value.image;
  if (!['image/png','image/jpeg','image/webp'].includes(mimeType) || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length > 24 * 1024 * 1024) throw new Error('Capture pixels are invalid or too large');
  const {image, mimeType:ignoredMime, ...metadata} = value;
  const result = jsonResult(metadata);
  result.content.unshift({type:'image',mimeType,data});
  return result;
}

function sendError(response, code, message, id = null) {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  response.end(JSON.stringify({jsonrpc:'2.0',error:{code:-32000,message},id}));
}

async function readBody(request) {
  const declared = request.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw Object.assign(new Error('Request body too large'),{httpCode:413});
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Request body too large'),{httpCode:413});
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected one JSON-RPC object');
    return body;
  } catch { throw Object.assign(new Error('Invalid JSON request'),{httpCode:400}); }
}

/** Expose only the workbench tool allowlist. invoke must enforce game and filesystem boundaries too. */
async function startMcpServer({invoke,status,root,token=randomBytes(32).toString('hex'),port=0,runtimePath,audit} = {}) {
  if (typeof invoke !== 'function' || typeof root !== 'string' || !root) throw new TypeError('invoke and root are required');
  if (!/^[a-f0-9]{64}$/.test(token)) throw new TypeError('Invalid MCP bearer token');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid MCP port');
  const projectRoot = await fs.realpath(path.resolve(root));
  const runtime = path.resolve(runtimePath || path.join(projectRoot,'.runtime','mcp-connection.json'));
  const active = new Set(); let closing = false, closePromise;
  const auditEntry = (operation,stage,details={}) => {
    try {
      if (typeof audit === 'function') audit('info',operation,stage,details);
      else audit?.write('info',operation,stage,details);
    } catch { /* Audit availability must not expose headers or interrupt emergency stop. */ }
  };
  const hideToken = value => String(value).split(token).join('[redacted]');
  const buildServer = () => {
    const server = new McpServer({name:'echo-test',version:VERSION}, {
      instructions:'Operate only the game selected in the workbench. Read echo_test_windows, connect, and capture first. Prefer echo_test_explore for short inline fragments; it waits and returns results plus a final image without saving temporary cases. Verify screenshot/assertions, then assemble and save a formal case with echo_test_save_case. Store templates by safe names. For long saved cases use run_case and status/events/report. Never infer task completion from a successful input step alone.',
    });
    for (const [name, description, schema, readOnly=false] of tools) {
      server.registerTool(name,{description,inputSchema:schema,annotations:{readOnlyHint:readOnly,destructiveHint:!readOnly,idempotentHint:readOnly,openWorldHint:false}},async args => {
        const started = Date.now();
        auditEntry(name,'start');
        try {
          const parsed = schema.parse(args);
          const output = name === 'echo_test_status' && typeof status === 'function' ? await status() : await invoke(name,parsed);
          const result = name === 'echo_test_capture' || (['echo_test_preview_target','echo_test_explore'].includes(name) && output?.image) ? imageResult(output) : jsonResult(output);
          auditEntry(name,'complete',{elapsedMs:Date.now()-started});
          return result;
        } catch (error) {
          auditEntry(name,'failed',{elapsedMs:Date.now()-started});
          return {content:[{type:'text',text:hideToken(error.message || error).slice(0,4000)}],isError:true};
        }
      });
    }
    return server;
  };
  const httpServer = http.createServer(async (request,response) => {
    response.setHeader('Cache-Control','no-store');
    let entry;
    try {
      const host = request.headers.host;
      const actualPort = httpServer.address()?.port;
      const acceptedHosts = [`127.0.0.1:${actualPort}`,`localhost:${actualPort}`];
      if (request.socket.remoteAddress !== '127.0.0.1' || !acceptedHosts.includes(host) || request.headers.origin !== undefined) {
        sendError(response,403,'Only native loopback clients are allowed'); return;
      }
      const supplied = request.headers.authorization || '';
      const expected = `Bearer ${token}`;
      const suppliedBytes = Buffer.from(supplied); const expectedBytes = Buffer.from(expected);
      if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes,expectedBytes)) {
        response.setHeader('WWW-Authenticate','Bearer'); sendError(response,401,'MCP bearer authentication required'); return;
      }
      if (request.url !== '/mcp') { sendError(response,404,'Unknown endpoint'); return; }
      if (request.method !== 'POST') { response.setHeader('Allow','POST'); sendError(response,405,'This stateless MCP endpoint accepts POST requests'); return; }
      if (closing) { sendError(response,503,'Workbench MCP server is closing'); return; }
      if (active.size >= MAX_ACTIVE_REQUESTS) { sendError(response,429,'Too many concurrent MCP requests'); return; }
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '') || (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity')) {
        sendError(response,415,'Expected uncompressed application/json'); return;
      }
      // Reserve a slot while receiving a body, so slow/large senders cannot bypass the concurrency cap.
      entry = {server:null,transport:null,response}; active.add(entry);
      const body = await readBody(request);
      // Validate raw arguments before SDK parsing, preventing unknown keys from being stripped silently.
      if (body.method === 'tools/call') {
        const definition = tools.find(([name]) => name === body.params?.name);
        if (definition) {
          const validation = definition[2].safeParse(body.params?.arguments ?? {});
          if (!validation.success) { sendError(response,400,'Invalid workbench tool arguments',body.id ?? null); return; }
        }
      }
      entry.server = buildServer();
      entry.transport = new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
      await entry.server.connect(entry.transport);
      await entry.transport.handleRequest(request,response,body);
    } catch (error) {
      auditEntry('mcp.request','failed');
      sendError(response,error.httpCode || 500,error.httpCode ? error.message : 'MCP request failed');
    } finally {
      if (entry) {
        await entry.server?.close().catch(() => {});
        await entry.transport?.close().catch(() => {});
        active.delete(entry);
      }
    }
  });
  httpServer.headersTimeout = 10000;
  httpServer.requestTimeout = 15000;
  httpServer.keepAliveTimeout = 1000;
  httpServer.maxHeadersCount = 40;
  await new Promise((resolve,reject) => {
    const failure = error => reject(error);
    httpServer.once('error',failure);
    httpServer.listen(port,'127.0.0.1',() => { httpServer.removeListener('error',failure); resolve(); });
  });
  const actualPort = httpServer.address().port;
  const url = `http://127.0.0.1:${actualPort}/mcp`;
  const descriptor = {url,token,pid:process.pid,version:VERSION,root:projectRoot};
  let runtimeIdentity;
  try {
    await fs.mkdir(path.dirname(runtime),{recursive:true});
    const handle = await fs.open(runtime,'wx',0o600);
    try { await handle.writeFile(JSON.stringify(descriptor),'utf8'); runtimeIdentity = await handle.stat(); }
    finally { await handle.close(); }
  } catch (error) {
    await new Promise(resolve => httpServer.close(resolve));
    throw error;
  }
  const close = () => closePromise ||= (async () => {
    closing = true;
    const httpClosed = new Promise(resolve => httpServer.close(resolve));
    for (const entry of active) {
      sendError(entry.response,503,'Workbench MCP server is closing');
      entry.response.end();
    }
    await Promise.allSettled([...active].flatMap(entry => [entry.server?.close(),entry.transport?.close()]));
    httpServer.closeAllConnections?.();
    await httpClosed;
    try {
      const currentStat = await fs.lstat(runtime);
      if (!currentStat.isSymbolicLink() && currentStat.ino === runtimeIdentity.ino && currentStat.dev === runtimeIdentity.dev) {
        const current = JSON.parse(await fs.readFile(runtime,'utf8'));
        if (current.pid === process.pid && current.token === token && current.url === url && current.root === projectRoot) await fs.unlink(runtime);
      }
    } catch (error) { if (error.code !== 'ENOENT') auditEntry('mcp.runtime','cleanup_failed'); }
    auditEntry('mcp.server','closed');
  })();
  auditEntry('mcp.server','listening',{port:actualPort});
  return {port:actualPort,url,runtimePath:runtime,close};
}

module.exports = {startMcpServer,projectSchema,selectorSchema,explorationSchema,safeBasename,MAX_BODY_BYTES};
