"""Bounded, conservative editor hints. This module never executes source code."""
from __future__ import annotations

import ast

MAX_SOURCE_BYTES = 256 * 1024
MAX_AST_NODES = 20000
MAX_REFERENCES = 500
MAX_VALUE_LENGTH = 512


def _merge_names(*states):
    names = set().union(*(state.keys() for state in states))
    return {name: states[0][name] if all(state.get(name) == states[0].get(name) for state in states) else ('unknown', name) for name in names}


def _rebound_names(body):
    """Names that cannot safely be captured by a deferred function hint.

    Count bindings in this lexical scope only. Explicit global/nonlocal
    declarations in nested scopes are conservative evidence of mutability.
    """
    counts = {}
    def count(name):
        counts[name] = counts.get(name, 0) + 1
    def walk(items):
        for item in items:
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                count(item.name)
                continue
            if isinstance(item, ast.Name) and isinstance(item.ctx, (ast.Store, ast.Del)):
                count(item.id)
            elif isinstance(item, (ast.Import, ast.ImportFrom)):
                for alias in item.names:
                    count(alias.asname or alias.name.split('.')[0])
            elif isinstance(item, (ast.ExceptHandler, ast.MatchAs, ast.MatchStar)) and item.name:
                count(item.name)
            elif isinstance(item, ast.MatchMapping) and item.rest:
                count(item.rest)
            walk(ast.iter_child_nodes(item))
    walk(body)
    declared = {name for item in body for child in ast.walk(item) if isinstance(child, (ast.Global, ast.Nonlocal)) for name in child.names}
    # controls already has an injected runtime binding before the source starts.
    return {name for name, count in counts.items() if count > 1 or name == 'controls'} | declared


class _References(ast.NodeVisitor):
    def __init__(self, tree, source, include_ranges=False):
        self.names = {'controls': ('root', '')}
        self.references = []
        self.seen = set()
        self.truncated = False
        self.function_names = None
        self.rebindings = _rebound_names(tree.body)
        self.lines = source.replace('\r\n', '\n').replace('\r', '\n').split('\n')
        self.include_ranges = include_ranges

    def column(self, line, byte_offset):
        # Python AST offsets are UTF-8 bytes; Monaco positions are UTF-16 units.
        prefix = self.lines[line-1].encode('utf-8')[:byte_offset].decode('utf-8')
        return len(prefix.encode('utf-16-le')) // 2 + 1

    def value(self, node):
        if isinstance(node, ast.Name):
            return self.names.get(node.id)
        target = None
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'by_id':
            root = node.func.value
            if isinstance(root, ast.Name) and root.id == 'controls':
                if self.names.get('controls') != ('root', ''):
                    return ('unknown', 'controls')
                target = node.args[0] if len(node.args) == 1 and not node.keywords else None
                kind = 'id'
            else:
                return None
        elif isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name) and node.value.id == 'controls':
            if self.names.get('controls') != ('root', ''):
                return ('unknown', 'controls')
            target, kind = node.slice, 'name'
        else:
            return None
        if isinstance(target, ast.Constant) and isinstance(target.value, str):
            if len(target.value) <= MAX_VALUE_LENGTH:
                return (kind, target.value)
        return ('dynamic', 'controls')

    def add(self, node, value):
        if not value or value[0] == 'root':
            return
        location = dict(line=node.lineno)
        if self.include_ranges:
            location.update(column=self.column(node.lineno, node.col_offset), endLine=node.end_lineno,
                            endColumn=self.column(node.end_lineno, node.end_col_offset))
        key = (*location.values(), *value)
        if key in self.seen:
            return
        self.seen.add(key)
        if len(self.references) >= MAX_REFERENCES:
            self.truncated = True
        else:
            self.references.append(dict(**location, kind=value[0], value=value[1]))

    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load):
            self.add(node, self.value(node))

    def visit_Call(self, node):
        value = self.value(node)
        if value:
            self.add(node, value)
        else:
            self.generic_visit(node)

    def visit_Subscript(self, node):
        value = self.value(node)
        if value:
            self.add(node, value)
        else:
            self.generic_visit(node)

    def bind(self, target, value=None):
        for item in ast.walk(target):
            if isinstance(item, ast.Name) and isinstance(item.ctx, (ast.Store, ast.Del)):
                if value and isinstance(target, ast.Name):
                    self.names[item.id] = value
                elif item.id in self.names:
                    self.names[item.id] = ('unknown', item.id)

    def visit_Assign(self, node):
        self.visit(node.value)
        value = self.value(node.value)
        for target in node.targets:
            self.bind(target, value)

    def visit_AnnAssign(self, node):
        if node.value:
            self.visit(node.value)
        self.bind(node.target, self.value(node.value))

    def visit_AugAssign(self, node):
        self.visit(node.value)
        self.bind(node.target)

    def visit_Delete(self, node):
        for target in node.targets:
            self.bind(target)

    def visit_NamedExpr(self, node):
        self.visit(node.value)
        self.bind(node.target, self.value(node.value))

    def visit_FunctionDef(self, node):
        for item in node.decorator_list + node.args.defaults + [v for v in node.args.kw_defaults if v]:
            self.visit(item)
        self.bind(ast.Name(id=node.name, ctx=ast.Store()))
        outer = self.names
        enclosing_functions = self.function_names
        self.names = (enclosing_functions if enclosing_functions is not None else outer).copy()
        for name in self.rebindings:
            if name in self.names:
                self.names[name] = ('unknown', name)
        enclosing_rebindings = self.rebindings
        self.rebindings = self.rebindings | _rebound_names(node.body)
        self.function_names = None
        # Python determines function locals for the entire body, including uses
        # before assignment. Never infer an outer alias for such a local.
        local_nodes = list(node.args.posonlyargs) + list(node.args.args) + list(node.args.kwonlyargs)
        local_nodes += [arg for arg in (node.args.vararg, node.args.kwarg) if arg]
        local_names = {arg.arg for arg in local_nodes}
        def locals_in(items):
            for item in items:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    local_names.add(item.name)
                    continue
                if isinstance(item, ast.Name) and isinstance(item.ctx, ast.Store):
                    local_names.add(item.id)
                if isinstance(item, (ast.ExceptHandler, ast.MatchAs, ast.MatchStar)) and item.name:
                    local_names.add(item.name)
                if isinstance(item, ast.MatchMapping) and item.rest:
                    local_names.add(item.rest)
                if isinstance(item, (ast.Import, ast.ImportFrom)):
                    local_names.update(alias.asname or alias.name.split('.')[0] for alias in item.names)
                locals_in(ast.iter_child_nodes(item))
        locals_in(node.body)
        for name in local_names:
            if name in self.names:
                self.names[name] = ('unknown', name)
        for item in node.body:
            self.visit(item)
        self.names = outer
        self.function_names = enclosing_functions
        self.rebindings = enclosing_rebindings

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_Lambda(self, node):
        outer = self.names
        enclosing_functions = self.function_names
        self.names = (enclosing_functions if enclosing_functions is not None else outer).copy()
        for name in self.rebindings:
            if name in self.names:
                self.names[name] = ('unknown', name)
        self.function_names = None
        for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs + [a for a in (node.args.vararg, node.args.kwarg) if a]:
            if arg.arg in self.names:
                self.names[arg.arg] = ('unknown', arg.arg)
        self.visit(node.body)
        self.names = outer
        self.function_names = enclosing_functions

    def visit_ClassDef(self, node):
        for item in node.bases + node.decorator_list:
            self.visit(item)
        self.bind(ast.Name(id=node.name, ctx=ast.Store()))
        outer = self.names
        enclosing_functions = self.function_names
        self.function_names = enclosing_functions if enclosing_functions is not None else outer
        self.names = outer.copy()
        for item in node.body:
            self.visit(item)
        self.names = outer
        self.function_names = enclosing_functions

    def visit_If(self, node):
        self.visit(node.test)
        outer = self.names.copy()
        for item in node.body:
            self.visit(item)
        yes = self.names
        self.names = outer.copy()
        for item in node.orelse:
            self.visit(item)
        no = self.names
        self.names = _merge_names(yes, no)

    def visit_IfExp(self, node):
        self.visit(node.test)
        initial = self.names.copy()
        self.visit(node.body)
        yes = self.names
        self.names = initial
        self.visit(node.orelse)
        self.names = _merge_names(yes, self.names)

    def visit_BoolOp(self, node):
        self.visit(node.values[0])
        for value in node.values[1:]:
            skipped = self.names.copy()
            self.visit(value)
            self.names = _merge_names(skipped, self.names)

    def visit_Try(self, node):
        prefixes = [self.names.copy()]
        for item in node.body:
            self.visit(item)
            prefixes.append(self.names.copy())
        for item in node.orelse:
            self.visit(item)
        outcomes = [self.names.copy()]
        for handler in node.handlers:
            self.names = _merge_names(*prefixes)
            if handler.type:
                self.visit(handler.type)
            if handler.name and handler.name in self.names:
                self.names[handler.name] = ('unknown', handler.name)
            for item in handler.body:
                self.visit(item)
            outcomes.append(self.names.copy())
        self.names = _merge_names(*outcomes)
        if node.finalbody:
            self.names = _merge_names(*prefixes, *outcomes)
            for item in node.finalbody:
                self.visit(item)

    visit_TryStar = visit_Try

    def visit_Match(self, node):
        self.visit(node.subject)
        initial = self.names.copy()
        outcomes = [initial]
        for case in node.cases:
            self.names = initial.copy()
            captures = {item.name for item in ast.walk(case.pattern) if isinstance(item, (ast.MatchAs, ast.MatchStar)) and item.name}
            captures.update(item.rest for item in ast.walk(case.pattern) if isinstance(item, ast.MatchMapping) and item.rest)
            for name in captures:
                if name in self.names:
                    self.names[name] = ('unknown', name)
            self.visit(case.pattern)
            if case.guard:
                self.visit(case.guard)
            for item in case.body:
                self.visit(item)
            outcomes.append(self.names.copy())
        self.names = _merge_names(*outcomes)

    def uncertain_block(self, node):
        # Loop/exception paths have no single certain assignment outcome.
        changed = {n.id for n in ast.walk(node) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store)}
        changed.update(n.name for n in ast.walk(node) if isinstance(n, (ast.ExceptHandler, ast.MatchAs, ast.MatchStar)) and n.name)
        changed.update(n.rest for n in ast.walk(node) if isinstance(n, ast.MatchMapping) and n.rest)
        for name in changed:
            if name in self.names:
                self.names[name] = ('unknown', name)
        self.generic_visit(node)
        for name in changed:
            if name in self.names:
                self.names[name] = ('unknown', name)

    visit_For = uncertain_block
    visit_AsyncFor = uncertain_block
    visit_While = uncertain_block
    visit_With = uncertain_block
    visit_AsyncWith = uncertain_block

    def comprehension(self, node):
        outer = self.names
        self.names = outer.copy()
        for generator in node.generators:
            self.visit(generator.iter)
            for name in ast.walk(generator.target):
                if isinstance(name, ast.Name) and name.id in self.names:
                    self.names[name.id] = ('unknown', name.id)
            for condition in generator.ifs:
                self.visit(condition)
        if isinstance(node, ast.DictComp):
            self.visit(node.key)
            self.visit(node.value)
        else:
            self.visit(node.elt)
        self.names = outer

    visit_ListComp = comprehension
    visit_SetComp = comprehension
    visit_DictComp = comprehension
    visit_GeneratorExp = comprehension

    def visit_Import(self, node):
        for alias in node.names:
            name = alias.asname or alias.name.split('.')[0]
            if name in self.names:
                self.names[name] = ('unknown', name)

    visit_ImportFrom = visit_Import


def control_references(source, include_ranges=False):
    """Return {references:[{line,kind,value}], error, truncated}; lines are 1-based.

    kind is id/name for literals and aliases, dynamic for computed lookups,
    unknown for shadowed/reassigned references. Incomplete syntax returns no
    references. Limits and parsing failures are nonfatal editor hint results.
    include_ranges adds 1-based UTF-16 column/endLine/endColumn positions and
    retains separate occurrences of the same control on one line.
    """
    result = {'references': [], 'error': None, 'truncated': False}
    if not isinstance(source, str) or len(source) > MAX_SOURCE_BYTES or len(source.encode('utf-8', errors='surrogatepass')) > MAX_SOURCE_BYTES:
        return {**result, 'error': 'limit'}
    try:
        tree = ast.parse(source)
        if sum(1 for _ in ast.walk(tree)) > MAX_AST_NODES:
            return {**result, 'error': 'limit'}
        visitor = _References(tree, source, include_ranges)
        visitor.visit(tree)
        return {**result, 'references': sorted(visitor.references, key=lambda ref: ref['line']), 'truncated': visitor.truncated}
    except (SyntaxError, ValueError):
        return {**result, 'error': 'syntax'}
    except (RecursionError, MemoryError):
        return {**result, 'error': 'limit'}
