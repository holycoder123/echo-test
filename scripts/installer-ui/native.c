/* Native presentation only. NSIS owns navigation, extraction and cancellation.
 * The host retains this DLL until process exit: window subclass callbacks live here.
 */
#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0601
#include <windows.h>
#include "common-controls.h"
#include <wchar.h>

#define WHITE RGB(255,255,255)
#define SOFT RGB(247,247,248)
#define LINE RGB(233,233,236)
#define INK RGB(35,36,40)
#define DARK RGB(38,39,44)
#define MUTED RGB(115,118,128)
#define GREEN RGB(37,129,106)
#define CLOSE_ID 3200
#define CHROME_SUBCLASS 0xEC01
#define BUTTON_SUBCLASS 0xEC02
#define PAGE_SUBCLASS 0xEC03

typedef struct Chrome {
    HWND window;
    UINT dpi;
    int step, uninstall;
    HFONT normal, small, brand, number;
    HICON icon;
    HBRUSH white, soft;
    WCHAR version[64];
} Chrome;

typedef struct ProgressPage {
    HWND page;
    UINT dpi;
    int stage, details, uninstall;
    HFONT normal, small, heading, percentage;
    HBRUSH white;
} ProgressPage;

static Chrome *active;
static ProgressPage *progress_active;
static void layout(Chrome *s, BOOL center);
static HINSTANCE module_instance;

static int scale(UINT dpi, int value) { return MulDiv(value, (int)dpi, 96); }
static UINT window_dpi(HWND hwnd) {
    typedef UINT (WINAPI *GetDpiForWindowFn)(HWND);
    GetDpiForWindowFn fn = (GetDpiForWindowFn)GetProcAddress(GetModuleHandleW(L"user32.dll"), "GetDpiForWindow");
    if (fn) { UINT dpi = fn(hwnd); if (dpi) return dpi; }
    HDC dc = GetDC(hwnd);
    UINT dpi = dc ? (UINT)GetDeviceCaps(dc, LOGPIXELSX) : 96;
    if (dc) ReleaseDC(hwnd, dc);
    return dpi ? dpi : 96;
}
static HFONT font(UINT dpi, int px, int weight) {
    return CreateFontW(-scale(dpi,px),0,0,0,weight,FALSE,FALSE,FALSE,DEFAULT_CHARSET,
        OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH|FF_SWISS,L"Microsoft YaHei UI");
}
static void place(HWND hwnd, UINT dpi, int x, int y, int w, int h) {
    if (hwnd) SetWindowPos(hwnd,NULL,scale(dpi,x),scale(dpi,y),scale(dpi,w),scale(dpi,h),SWP_NOZORDER|SWP_NOACTIVATE);
}
static void text(HDC dc, UINT dpi, HFONT face, COLORREF color, LPCWSTR value,
                 int x, int y, int w, int h, UINT flags) {
    RECT rect = {scale(dpi,x),scale(dpi,y),scale(dpi,x+w),scale(dpi,y+h)};
    HGDIOBJ old = SelectObject(dc,face);
    SetTextColor(dc,color); SetBkMode(dc,TRANSPARENT);
    DrawTextW(dc,value,-1,&rect,flags|DT_SINGLELINE|DT_NOPREFIX);
    SelectObject(dc,old);
}
static void line(HDC dc, UINT dpi, COLORREF color, int x1, int y1, int x2, int y2) {
    HPEN pen = CreatePen(PS_SOLID,scale(dpi,1),color);
    HGDIOBJ old = SelectObject(dc,pen);
    MoveToEx(dc,scale(dpi,x1),scale(dpi,y1),NULL);
    LineTo(dc,scale(dpi,x2),scale(dpi,y2));
    SelectObject(dc,old); DeleteObject(pen);
}

static void paint_chrome(Chrome *s, HDC target) {
    RECT client; GetClientRect(s->window,&client);
    HDC dc = CreateCompatibleDC(target);
    HBITMAP bitmap = CreateCompatibleBitmap(target,client.right,client.bottom);
    if (!dc || !bitmap) { if(dc)DeleteDC(dc); if(bitmap)DeleteObject(bitmap); return; }
    HGDIOBJ previous = SelectObject(dc,bitmap);
    FillRect(dc,&client,s->white);
    RECT band={0,scale(s->dpi,52),client.right,scale(s->dpi,132)};
    FillRect(dc,&band,s->soft);
    RECT footer={0,client.bottom-scale(s->dpi,72),client.right,client.bottom};
    FillRect(dc,&footer,s->soft);
    line(dc,s->dpi,LINE,0,51,736,51); line(dc,s->dpi,LINE,0,132,736,132);
    line(dc,s->dpi,LINE,0,(client.bottom*96/(int)s->dpi)-72,736,(client.bottom*96/(int)s->dpi)-72);
    if(s->icon) DrawIconEx(dc,scale(s->dpi,20),scale(s->dpi,14),s->icon,scale(s->dpi,23),scale(s->dpi,23),0,NULL,DI_NORMAL);
    text(dc,s->dpi,s->brand,INK,L"EchoTest",53,15,69,23,DT_VCENTER);
    text(dc,s->dpi,s->small,MUTED,s->uninstall?L"卸载向导":L"安装向导",137,17,100,22,DT_VCENTER);
    line(dc,s->dpi,LINE,125,18,125,35);
    text(dc,s->dpi,s->small,MUTED,s->version,565,17,110,22,DT_RIGHT|DT_VCENTER);
    text(dc,s->dpi,s->small,MUTED,L"EchoTest · 桌面自动化测试工作台",26,(client.bottom*96/(int)s->dpi)-50,370,26,DT_VCENTER);
    if(s->uninstall) {
        text(dc,s->dpi,s->normal,INK,s->step>=3?L"卸载完成":L"卸载 EchoTest",38,74,650,32,DT_VCENTER);
    } else {
        static const WCHAR *labels[]={L"欢迎",L"安装选项",L"安装",L"完成"};
        static const int centers[]={51,246,459,646};
        static const int link_start[]={113,329,515}, link_end[]={207,420,607};
        for(int i=0;i<3;i++)line(dc,s->dpi,RGB(222,223,227),link_start[i],91,link_end[i],91);
        for(int i=0;i<4;i++) {
            COLORREF edge=i<s->step?RGB(204,228,219):(i==s->step?DARK:RGB(217,219,224));
            HBRUSH brush=CreateSolidBrush(i<s->step?RGB(237,246,242):(i==s->step?DARK:WHITE));
            HPEN pen=CreatePen(PS_SOLID,scale(s->dpi,1),edge);
            HGDIOBJ oldbrush=SelectObject(dc,brush),oldpen=SelectObject(dc,pen);
            Ellipse(dc,scale(s->dpi,centers[i]-11),scale(s->dpi,80),scale(s->dpi,centers[i]+12),scale(s->dpi,103));
            SelectObject(dc,oldpen);SelectObject(dc,oldbrush);DeleteObject(pen);DeleteObject(brush);
            if(i<s->step) {
                HPEN tick=CreatePen(PS_SOLID,scale(s->dpi,1),GREEN);oldpen=SelectObject(dc,tick);
                MoveToEx(dc,scale(s->dpi,centers[i]-4),scale(s->dpi,91),NULL);
                LineTo(dc,scale(s->dpi,centers[i]-1),scale(s->dpi,95));
                LineTo(dc,scale(s->dpi,centers[i]+5),scale(s->dpi,86));
                SelectObject(dc,oldpen);DeleteObject(tick);
            } else {
                WCHAR number[2]={(WCHAR)(L'1'+i),0};
                text(dc,s->dpi,s->number,i==s->step?WHITE:MUTED,number,centers[i]-11,80,23,23,DT_CENTER|DT_VCENTER);
            }
            text(dc,s->dpi,s->small,i==s->step?INK:MUTED,labels[i],centers[i]+21,79,82,25,DT_VCENTER);
        }
    }
    BitBlt(target,0,0,client.right,client.bottom,dc,0,0,SRCCOPY);
    SelectObject(dc,previous); DeleteObject(bitmap); DeleteDC(dc);
}

/* A real non-client border stays visible above every full-width NSIS page. */
static void paint_frame(Chrome *s,HDC dc) {
    RECT r;GetWindowRect(s->window,&r);OffsetRect(&r,-r.left,-r.top);
    HPEN pen=CreatePen(PS_SOLID,1,RGB(217,219,224));
    HGDIOBJ oldpen=SelectObject(dc,pen),oldbrush=SelectObject(dc,GetStockObject(NULL_BRUSH));
    RoundRect(dc,0,0,r.right,r.bottom,scale(s->dpi,12),scale(s->dpi,12));
    SelectObject(dc,oldbrush);SelectObject(dc,oldpen);DeleteObject(pen);
}
static void repaint_frame(Chrome *s) {
    HDC dc=GetWindowDC(s->window);if(dc){paint_frame(s,dc);ReleaseDC(s->window,dc);}
}

static void draw_button(DRAWITEMSTRUCT *item, UINT dpi, HFONT face) {
    int id=(int)item->CtlID;
    BOOL close=id==CLOSE_ID, primary=id==IDOK, disabled=(item->itemState&ODS_DISABLED)!=0;
    BOOL pressed=(item->itemState&ODS_SELECTED)!=0;
    BOOL hovered=GetPropW(item->hwndItem,L"EchoSetupHover")!=NULL;
    COLORREF fill=close?((hovered||pressed)&&!disabled?LINE:WHITE):(primary?(disabled?RGB(190,192,198):(pressed?RGB(19,20,24):(hovered?RGB(57,58,65):DARK))):(pressed?LINE:(hovered?SOFT:WHITE)));
    RECT rect=item->rcItem;
    HBRUSH surround=CreateSolidBrush(close||id==1027?WHITE:SOFT); FillRect(item->hDC,&rect,surround); DeleteObject(surround);
    HBRUSH brush=CreateSolidBrush(fill);
    HPEN pen=CreatePen(PS_SOLID,scale(dpi,1),close?fill:(primary?fill:LINE));
    HGDIOBJ oldbrush=SelectObject(item->hDC,brush),oldpen=SelectObject(item->hDC,pen);
    RoundRect(item->hDC,rect.left,rect.top,rect.right,rect.bottom,scale(dpi,7),scale(dpi,7));
    SelectObject(item->hDC,oldpen); SelectObject(item->hDC,oldbrush); DeleteObject(pen); DeleteObject(brush);
    if(close) {
        int cx=(rect.left+rect.right)/2,cy=(rect.top+rect.bottom)/2,r=scale(dpi,4);
        pen=CreatePen(PS_SOLID,scale(dpi,1),disabled?RGB(180,182,189):MUTED); oldpen=SelectObject(item->hDC,pen);
        MoveToEx(item->hDC,cx-r,cy-r,NULL);LineTo(item->hDC,cx+r+1,cy+r+1);
        MoveToEx(item->hDC,cx+r,cy-r,NULL);LineTo(item->hDC,cx-r-1,cy+r+1);
        SelectObject(item->hDC,oldpen);DeleteObject(pen);
    } else {
        WCHAR caption[128];GetWindowTextW(item->hwndItem,caption,128);
        HGDIOBJ oldfont=SelectObject(item->hDC,face);
        SetBkMode(item->hDC,TRANSPARENT);SetTextColor(item->hDC,disabled?(primary?WHITE:RGB(172,174,181)):(primary?WHITE:INK));
        DrawTextW(item->hDC,caption,-1,&rect,DT_CENTER|DT_VCENTER|DT_SINGLELINE|((item->itemState&ODS_NOACCEL)?DT_HIDEPREFIX:0));
        SelectObject(item->hDC,oldfont);
    }
    if((item->itemState&ODS_FOCUS)&&!(item->itemState&ODS_NOFOCUSRECT)) {
        InflateRect(&rect,-scale(dpi,4),-scale(dpi,4)); DrawFocusRect(item->hDC,&rect);
    }
}

static LRESULT CALLBACK button_proc(HWND hwnd, UINT message, WPARAM w, LPARAM l, UINT_PTR id, DWORD_PTR data) {
    (void)data;
    /* Dialog default-button bookkeeping must not replace our drawing style. */
    if(message==BM_SETSTYLE)w=(w&~BS_TYPEMASK)|BS_OWNERDRAW;
    if(message==WM_ENABLE&&GetDlgCtrlID(hwnd)==IDCANCEL) {
        HWND close=GetDlgItem(GetParent(hwnd),CLOSE_ID);
        if(close)EnableWindow(close,(BOOL)w);
    }
    if(message==WM_MOUSEMOVE&&!GetPropW(hwnd,L"EchoSetupHover")) {
        TRACKMOUSEEVENT event={sizeof(event),TME_LEAVE,hwnd,0};
        SetPropW(hwnd,L"EchoSetupHover",(HANDLE)1);TrackMouseEvent(&event);InvalidateRect(hwnd,NULL,FALSE);
    } else if(message==WM_MOUSELEAVE) {
        RemovePropW(hwnd,L"EchoSetupHover");InvalidateRect(hwnd,NULL,FALSE);
    } else if(message==WM_NCDESTROY) {
        RemovePropW(hwnd,L"EchoSetupHover");RemoveWindowSubclass(hwnd,button_proc,id);
    }
    return DefSubclassProc(hwnd,message,w,l);
}
static void style_button(HWND hwnd, HFONT face) {
    if(!hwnd)return;
    LONG_PTR style=GetWindowLongPtrW(hwnd,GWL_STYLE);
    SetWindowLongPtrW(hwnd,GWL_STYLE,(style&~BS_TYPEMASK)|BS_OWNERDRAW);
    SendMessageW(hwnd,WM_SETFONT,(WPARAM)face,FALSE);
    SetWindowSubclass(hwnd,button_proc,BUTTON_SUBCLASS,0);
    InvalidateRect(hwnd,NULL,FALSE);
}

static void layout(Chrome *s, BOOL center) {
    int extra=progress_active&&progress_active->details&&!progress_active->uninstall?120:0;
    RECT rect={0,0,scale(s->dpi,736),scale(s->dpi,600+extra)};
    DWORD style=(DWORD)GetWindowLongPtrW(s->window,GWL_STYLE),ex=(DWORD)GetWindowLongPtrW(s->window,GWL_EXSTYLE);
    AdjustWindowRectEx(&rect,style,FALSE,ex);
    int width=rect.right-rect.left,height=rect.bottom-rect.top;
    RECT previous;GetWindowRect(s->window,&previous);
    int x=previous.left,y=previous.top;
    if(center) {
        MONITORINFO monitor={0};monitor.cbSize=sizeof(monitor);
        if(GetMonitorInfoW(MonitorFromWindow(s->window,MONITOR_DEFAULTTONEAREST),&monitor)) {
            x=monitor.rcWork.left+(monitor.rcWork.right-monitor.rcWork.left-width)/2;
            y=monitor.rcWork.top+(monitor.rcWork.bottom-monitor.rcWork.top-height)/2;
        }
    }
    SetWindowPos(s->window,NULL,x,y,width,height,SWP_NOZORDER|SWP_NOACTIVATE|SWP_FRAMECHANGED);
    HRGN corners=CreateRoundRectRgn(0,0,width+1,height+1,scale(s->dpi,12),scale(s->dpi,12));
    if(corners&&!SetWindowRgn(s->window,corners,TRUE))DeleteObject(corners);
    place(GetDlgItem(s->window,1018),s->dpi,0,132,736,396+extra);
    place(GetDlgItem(s->window,IDOK),s->dpi,606,548+extra,104,35);
    place(GetDlgItem(s->window,3),s->dpi,520,548+extra,78,35);
    place(GetDlgItem(s->window,IDCANCEL),s->dpi,s->step==0?520:(s->step==2?606:434),548+extra,78,35);
    place(GetDlgItem(s->window,CLOSE_ID),s->dpi,690,12,30,30);
    ShowWindow(GetDlgItem(s->window,1028),SW_HIDE);
}
static void release_chrome(Chrome *s) {
    if(active==s)active=NULL;
    if(s->icon)DestroyIcon(s->icon);
    DeleteObject(s->normal);DeleteObject(s->small);DeleteObject(s->brand);DeleteObject(s->number);
    DeleteObject(s->white);DeleteObject(s->soft);HeapFree(GetProcessHeap(),0,s);
}
static LRESULT CALLBACK chrome_proc(HWND hwnd, UINT message, WPARAM w, LPARAM l, UINT_PTR id, DWORD_PTR data) {
    Chrome *s=(Chrome *)data;
    switch(message) {
    case WM_NCPAINT: repaint_frame(s);return 0;
    case WM_NCACTIVATE: {
        LRESULT result=DefSubclassProc(hwnd,message,w,l);repaint_frame(s);return result;
    }
    case WM_PRINT: {
        LRESULT result=DefSubclassProc(hwnd,message,w,l);
        if(l&PRF_NONCLIENT)paint_frame(s,(HDC)w);return result;
    }
    case WM_PAINT: { PAINTSTRUCT ps;HDC dc=BeginPaint(hwnd,&ps);paint_chrome(s,dc);EndPaint(hwnd,&ps);return 0; }
    case WM_PRINTCLIENT: paint_chrome(s,(HDC)w);return 0;
    case WM_ERASEBKGND: return 1;
    case WM_DRAWITEM: {
        DRAWITEMSTRUCT *item=(DRAWITEMSTRUCT *)l;
        if(item&&item->CtlType==ODT_BUTTON&&(item->CtlID==1||item->CtlID==2||item->CtlID==3||item->CtlID==CLOSE_ID)) { draw_button(item,s->dpi,s->normal);return TRUE; }
        break;
    }
    case WM_COMMAND:
        if(LOWORD(w)==CLOSE_ID&&HIWORD(w)==BN_CLICKED) {
            if(IsWindowEnabled(GetDlgItem(hwnd,IDCANCEL))) SendMessageW(hwnd,WM_COMMAND,MAKEWPARAM(IDCANCEL,BN_CLICKED),(LPARAM)GetDlgItem(hwnd,IDCANCEL));
            return 0;
        }
        break;
    case WM_NCHITTEST: {
        POINT point={(short)LOWORD(l),(short)HIWORD(l)};ScreenToClient(hwnd,&point);
        if(point.y>=0&&point.y<scale(s->dpi,52)&&point.x>=0&&point.x<scale(s->dpi,684))return HTCAPTION;
        break;
    }
    case WM_NCDESTROY: {
        RemoveWindowSubclass(hwnd,chrome_proc,id);
        LRESULT result=DefSubclassProc(hwnd,message,w,l);release_chrome(s);return result;
    }
    }
    return DefSubclassProc(hwnd,message,w,l);
}

__declspec(dllexport) int __cdecl EchoSetupAttach(HWND parent, LPCWSTR icon_file, LPCWSTR version, int uninstall) {
    if(!IsWindow(parent))return 0;
    if(active)return active->window==parent;
    INITCOMMONCONTROLSEX controls={sizeof(controls),ICC_STANDARD_CLASSES|ICC_PROGRESS_CLASS};InitCommonControlsEx(&controls);
    Chrome *s=(Chrome *)HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,sizeof(Chrome));if(!s)return 0;
    s->window=parent;s->dpi=window_dpi(parent);s->uninstall=uninstall;
    s->normal=font(s->dpi,13,FW_NORMAL);s->small=font(s->dpi,12,FW_NORMAL);
    s->brand=font(s->dpi,13,FW_BOLD);s->number=font(s->dpi,12,FW_BOLD);
    s->white=CreateSolidBrush(WHITE);s->soft=CreateSolidBrush(SOFT);
    if(version&&*version) { lstrcpynW(s->version,L"v",64);lstrcpynW(s->version+1,version,63); }
    if(icon_file&&*icon_file)s->icon=(HICON)LoadImageW(NULL,icon_file,IMAGE_ICON,scale(s->dpi,32),scale(s->dpi,32),LR_LOADFROMFILE);
    if(!SetWindowSubclass(parent,chrome_proc,CHROME_SUBCLASS,(DWORD_PTR)s)) {release_chrome(s);return 0;}
    active=s;
    SetWindowLongPtrW(parent,GWL_STYLE,GetWindowLongPtrW(parent,GWL_STYLE)|WS_CLIPCHILDREN);
    HWND close=GetDlgItem(parent,CLOSE_ID);
    if(!close)close=CreateWindowExW(0,L"BUTTON",L"关闭",WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW,0,0,0,0,parent,(HMENU)(INT_PTR)CLOSE_ID,module_instance,NULL);
    style_button(close,s->normal);
    style_button(GetDlgItem(parent,IDOK),s->normal);style_button(GetDlgItem(parent,IDCANCEL),s->normal);style_button(GetDlgItem(parent,3),s->normal);
    layout(s,TRUE);InvalidateRect(parent,NULL,TRUE);return 1;
}

__declspec(dllexport) void __cdecl EchoSetupStep(int step) {
    if(!active)return;
    if(step<0)step=0;if(step>3)step=3;active->step=step;
    if(step!=2&&progress_active&&progress_active->details) {
        progress_active->details=0;layout(active,FALSE);
    }
    RECT band={0,scale(active->dpi,52),scale(active->dpi,736),scale(active->dpi,132)};
    InvalidateRect(active->window,&band,FALSE);
    HWND cancel=GetDlgItem(active->window,IDCANCEL),close=GetDlgItem(active->window,CLOSE_ID);
    place(cancel,active->dpi,step==0?520:(step==2?606:434),548+(progress_active&&progress_active->details&&!progress_active->uninstall?120:0),78,35);
    EnableWindow(close,IsWindowEnabled(cancel));
}


static int progress_percent(HWND page) {
    HWND bar=GetDlgItem(page,1004);
    struct {int low,high;} range={0,30000};
    SendMessageW(bar,WM_USER+7,FALSE,(LPARAM)&range);
    int pos=(int)SendMessageW(bar,WM_USER+8,0,0),span=range.high-range.low;
    int percent=span>0?MulDiv(pos-range.low,100,span):0;
    return percent<0?0:(percent>100?100:percent);
}
static void update_progress(ProgressPage *s) {
    WCHAR label[16];wsprintfW(label,L"%d%%",progress_percent(s->page));
    SetWindowTextW(GetDlgItem(s->page,3305),label);
    InvalidateRect(GetDlgItem(s->page,1004),NULL,FALSE);
}
static void progress_layout(ProgressPage *s) {
    int extra=s->details&&!s->uninstall?120:0;
    place(s->page,s->dpi,0,132,736,396+extra);
    static const int positions[][5]={
        {3301,38,30,660,18},{3302,38,56,660,35},{3303,38,103,660,26},
        {3306,38,157,540,26},{3305,606,150,92,34},{1004,38,194,660,6},
        {3304,38,212,660,22},{3307,63,252,635,22},{3308,63,283,635,22},
        {3309,63,314,635,22},{3310,38,353,165,25},{1006,38,390,660,22},{1016,38,417,660,88}};
    for(unsigned i=0;i<sizeof(positions)/sizeof(positions[0]);i++) {
        const int *p=positions[i];place(GetDlgItem(s->page,p[0]),s->dpi,p[1],p[2],p[3],p[4]);
    }
    if(s->uninstall) {
        for(int task=3307;task<=3309;task++)ShowWindow(GetDlgItem(s->page,task),SW_HIDE);
        place(GetDlgItem(s->page,3310),s->dpi,38,254,165,25);
        place(GetDlgItem(s->page,1006),s->dpi,38,294,660,22);
        place(GetDlgItem(s->page,1016),s->dpi,38,322,660,62);
    }
    ShowWindow(GetDlgItem(s->page,1027),SW_HIDE);
    ShowWindow(GetDlgItem(s->page,1006),s->details?SW_SHOW:SW_HIDE);
    ShowWindow(GetDlgItem(s->page,1016),s->details?SW_SHOW:SW_HIDE);
}
static void paint_tasks(ProgressPage *s,HDC dc) {
    if(s->uninstall)return;
    for(int i=0;i<3;i++) {
        int y=263+i*31;COLORREF color=i<s->stage?GREEN:(i==s->stage?INK:MUTED);
        HPEN pen=CreatePen(PS_SOLID,scale(s->dpi,1),color);
        HGDIOBJ oldpen=SelectObject(dc,pen),oldbrush=SelectObject(dc,GetStockObject(NULL_BRUSH));
        Ellipse(dc,scale(s->dpi,38),scale(s->dpi,y-7),scale(s->dpi,52),scale(s->dpi,y+7));
        if(i<s->stage) {
            MoveToEx(dc,scale(s->dpi,41),scale(s->dpi,y),NULL);LineTo(dc,scale(s->dpi,44),scale(s->dpi,y+3));LineTo(dc,scale(s->dpi,49),scale(s->dpi,y-3));
        }else if(i==s->stage) {
            HBRUSH fill=CreateSolidBrush(color);SelectObject(dc,fill);
            Ellipse(dc,scale(s->dpi,44),scale(s->dpi,y-1),scale(s->dpi,47),scale(s->dpi,y+2));SelectObject(dc,oldbrush);DeleteObject(fill);
        }
        SelectObject(dc,oldpen);SelectObject(dc,oldbrush);DeleteObject(pen);
    }
}
static LRESULT CALLBACK bar_proc(HWND hwnd,UINT message,WPARAM w,LPARAM l,UINT_PTR id,DWORD_PTR data) {
    ProgressPage *s=(ProgressPage *)data;
    if(message==WM_PAINT) {
        PAINTSTRUCT ps;HDC dc=BeginPaint(hwnd,&ps);RECT r;GetClientRect(hwnd,&r);
        FillRect(dc,&r,s->white);
        HBRUSH track=CreateSolidBrush(RGB(236,238,242)),fill=CreateSolidBrush(DARK);
        HPEN no_pen=(HPEN)GetStockObject(NULL_PEN);HGDIOBJ oldpen=SelectObject(dc,no_pen),oldbrush=SelectObject(dc,track);
        RoundRect(dc,0,0,r.right,r.bottom,scale(s->dpi,6),scale(s->dpi,6));
        int width=MulDiv(r.right,progress_percent(s->page),100);
        if(width>0){SelectObject(dc,fill);RoundRect(dc,0,0,width,r.bottom,scale(s->dpi,6),scale(s->dpi,6));}
        SelectObject(dc,oldbrush);SelectObject(dc,oldpen);DeleteObject(track);DeleteObject(fill);EndPaint(hwnd,&ps);return 0;
    }
    if(message==WM_ERASEBKGND)return 1;
    if(message==WM_NCDESTROY)RemoveWindowSubclass(hwnd,bar_proc,id);
    LRESULT result=DefSubclassProc(hwnd,message,w,l);
    if(message>=WM_USER+1&&message<=WM_USER+6)PostMessageW(s->page,WM_APP+27,0,0);
    return result;
}
static LRESULT CALLBACK progress_proc(HWND hwnd,UINT message,WPARAM w,LPARAM l,UINT_PTR id,DWORD_PTR data) {
    ProgressPage *s=(ProgressPage *)data;
    if(message==WM_CTLCOLORSTATIC) {
        int control=GetDlgCtrlID((HWND)l);COLORREF color=MUTED;
        if(control==3302||control==3305)color=INK;
        if(control==3306)color=RGB(85,92,104);
        if(control>=3307&&control<=3309){int phase=control-3307;color=phase<s->stage?GREEN:(phase==s->stage?INK:MUTED);}
        SetBkColor((HDC)w,WHITE);SetTextColor((HDC)w,color);return (LRESULT)s->white;
    }
    if(message==WM_PAINT){PAINTSTRUCT ps;HDC dc=BeginPaint(hwnd,&ps);FillRect(dc,&ps.rcPaint,s->white);paint_tasks(s,dc);EndPaint(hwnd,&ps);return 0;}
    if(message==WM_ERASEBKGND){RECT r;GetClientRect(hwnd,&r);FillRect((HDC)w,&r,s->white);return 1;}
    if(message==WM_APP+27){update_progress(s);return 0;}
    if(message==WM_TIMER&&w==271){KillTimer(hwnd,271);progress_layout(s);update_progress(s);return 0;}
    if(message==WM_COMMAND&&LOWORD(w)==3310&&HIWORD(w)==BN_CLICKED) {
        s->details=!s->details;
        SetWindowTextW(GetDlgItem(hwnd,3310),s->details?L"收起安装详情":L"查看安装详情");
        if(active){layout(active,FALSE);InvalidateRect(active->window,NULL,TRUE);}
        progress_layout(s);InvalidateRect(hwnd,NULL,TRUE);return 0;
    }
    if(message==WM_DRAWITEM) {
        DRAWITEMSTRUCT *item=(DRAWITEMSTRUCT *)l;
        if(item&&item->CtlID==3310) {
            FillRect(item->hDC,&item->rcItem,s->white);HGDIOBJ prev=SelectObject(item->hDC,s->small);
            SetBkMode(item->hDC,TRANSPARENT);SetTextColor(item->hDC,MUTED);
            RECT r=item->rcItem;DrawTextW(item->hDC,s->details?L"▾ 收起安装详情":L"▸ 查看安装详情",-1,&r,DT_LEFT|DT_VCENTER|DT_SINGLELINE);
            SelectObject(item->hDC,prev);if(item->itemState&ODS_FOCUS)DrawFocusRect(item->hDC,&r);return TRUE;
        }
    }
    if(message==WM_NCDESTROY) {
        if(progress_active==s)progress_active=NULL;
        RemoveWindowSubclass(GetDlgItem(hwnd,1004),bar_proc,PAGE_SUBCLASS);
        RemovePropW(hwnd,L"EchoSetupProgressPage");RemoveWindowSubclass(hwnd,progress_proc,id);
        LRESULT result=DefSubclassProc(hwnd,message,w,l);
        DeleteObject(s->normal);DeleteObject(s->small);DeleteObject(s->heading);DeleteObject(s->percentage);DeleteObject(s->white);HeapFree(GetProcessHeap(),0,s);
        if(active){layout(active,FALSE);InvalidateRect(active->window,NULL,TRUE);}return result;
    }
    return DefSubclassProc(hwnd,message,w,l);
}
__declspec(dllexport) void __cdecl EchoSetupProgress(HWND page) {
    if(!IsWindow(page)||GetPropW(page,L"EchoSetupProgressPage"))return;
    ProgressPage *s=(ProgressPage *)HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,sizeof(ProgressPage));if(!s)return;
    s->page=page;s->uninstall=active&&active->uninstall;s->dpi=window_dpi(page);s->normal=font(s->dpi,13,FW_NORMAL);s->small=font(s->dpi,11,FW_NORMAL);
    s->heading=font(s->dpi,24,FW_BOLD);s->percentage=font(s->dpi,20,FW_MEDIUM);s->white=CreateSolidBrush(WHITE);
    if(!SetWindowSubclass(page,progress_proc,PAGE_SUBCLASS,(DWORD_PTR)s)){DeleteObject(s->normal);DeleteObject(s->small);DeleteObject(s->heading);DeleteObject(s->percentage);DeleteObject(s->white);HeapFree(GetProcessHeap(),0,s);return;}
    if(s->uninstall) {
        SetWindowTextW(GetDlgItem(page,3301),L"UNINSTALLING");
        SetWindowTextW(GetDlgItem(page,3302),L"正在卸载 EchoTest");
        SetWindowTextW(GetDlgItem(page,3303),L"正在移除程序，已有用例、控件与报告会保留。");
        SetWindowTextW(GetDlgItem(page,3306),L"正在移除程序和运行环境");
    }
    progress_active=s;SetPropW(page,L"EchoSetupProgressPage",(HANDLE)s);
    for(int control=3301;control<=3310;control++) {
        HFONT face=control==3302?s->heading:(control==3305?s->percentage:(control==3301||control==3304||control==3310?s->small:s->normal));
        SendMessageW(GetDlgItem(page,control),WM_SETFONT,(WPARAM)face,FALSE);
    }
    SendMessageW(GetDlgItem(page,1006),WM_SETFONT,(WPARAM)s->small,FALSE);
    SendMessageW(GetDlgItem(page,1016),WM_SETFONT,(WPARAM)s->small,FALSE);
    style_button(GetDlgItem(page,3310),s->small);
    SetWindowSubclass(GetDlgItem(page,1004),bar_proc,PAGE_SUBCLASS,(DWORD_PTR)s);
    progress_layout(s);SetTimer(page,271,20,NULL);InvalidateRect(page,NULL,TRUE);
}
__declspec(dllexport) void __cdecl EchoSetupStage(int stage) {
    ProgressPage *s=progress_active;if(!s)return;s->stage=stage<0?0:(stage>2?2:stage);
    static const WCHAR *captions[]={L"正在检查安装环境",L"正在写入程序与离线运行环境",L"正在创建快捷方式并完成配置"};
    SetWindowTextW(GetDlgItem(s->page,3306),captions[s->stage]);InvalidateRect(s->page,NULL,TRUE);update_progress(s);
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID reserved) {
    (void)reserved;if(reason==DLL_PROCESS_ATTACH)module_instance=instance;return TRUE;
}
