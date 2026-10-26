/* The documented ComCtl32 subset used by the UI, kept self-contained for the
 * private TinyCC toolchain. Windows owns every implementation below. */
#ifndef ECHO_SETUP_COMMON_CONTROLS_H
#define ECHO_SETUP_COMMON_CONTROLS_H

typedef struct tagINITCOMMONCONTROLSEX {
    DWORD dwSize;
    DWORD dwICC;
} INITCOMMONCONTROLSEX;

typedef LRESULT (CALLBACK *SUBCLASSPROC)(HWND,UINT,WPARAM,LPARAM,UINT_PTR,DWORD_PTR);
__declspec(dllimport) BOOL WINAPI InitCommonControlsEx(const INITCOMMONCONTROLSEX *);
__declspec(dllimport) BOOL WINAPI SetWindowSubclass(HWND,SUBCLASSPROC,UINT_PTR,DWORD_PTR);
__declspec(dllimport) BOOL WINAPI RemoveWindowSubclass(HWND,SUBCLASSPROC,UINT_PTR);
__declspec(dllimport) LRESULT WINAPI DefSubclassProc(HWND,UINT,WPARAM,LPARAM);

#define ICC_STANDARD_CLASSES 0x00004000
#define ICC_PROGRESS_CLASS 0x00000020
#define PBM_SETBARCOLOR (WM_USER+9)
#define PBM_SETBKCOLOR 0x2001

#endif
