"""Passive Windows Raw Input receiver. Never suppresses legacy/application input."""
import ctypes as ct
from ctypes import wintypes as wt
import traceback
from .backend import user32,kernel32

WNDPROC=ct.WINFUNCTYPE(ct.c_ssize_t,wt.HWND,wt.UINT,wt.WPARAM,wt.LPARAM)
kernel32.GetModuleHandleW.argtypes=[wt.LPCWSTR]
kernel32.GetModuleHandleW.restype=wt.HMODULE
class WindowClass(ct.Structure):
    _fields_=[('style',wt.UINT),('proc',WNDPROC),('class_extra',ct.c_int),('window_extra',ct.c_int),
              ('instance',wt.HINSTANCE),('icon',wt.HANDLE),('cursor',wt.HANDLE),('brush',wt.HANDLE),
              ('menu',wt.LPCWSTR),('name',wt.LPCWSTR)]
class Device(ct.Structure):
    _fields_=[('page',wt.USHORT),('usage',wt.USHORT),('flags',wt.DWORD),('target',wt.HWND)]
class Header(ct.Structure):
    _fields_=[('type',wt.DWORD),('size',wt.DWORD),('device',wt.HANDLE),('parameter',wt.WPARAM)]
class ButtonFields(ct.Structure):
    _fields_=[('flags',wt.USHORT),('data',wt.USHORT)]
class Buttons(ct.Union):
    _anonymous_=('fields',)
    _fields_=[('value',wt.ULONG),('fields',ButtonFields)]
class RawMouse(ct.Structure):
    _anonymous_=('buttons',)
    _fields_=[('move_flags',wt.USHORT),('buttons',Buttons),('raw_buttons',wt.ULONG),
              ('dx',wt.LONG),('dy',wt.LONG),('extra',wt.ULONG)]
class RawKey(ct.Structure):
    _fields_=[('scan',wt.USHORT),('flags',wt.USHORT),('reserved',wt.USHORT),('vk',wt.USHORT),
              ('message',wt.UINT),('extra',wt.ULONG)]
class Payload(ct.Union):
    _fields_=[('mouse',RawMouse),('key',RawKey)]
class Packet(ct.Structure):
    _fields_=[('header',Header),('data',Payload)]

user32.RegisterClassW.argtypes=[ct.POINTER(WindowClass)]
user32.RegisterClassW.restype=wt.ATOM
user32.UnregisterClassW.argtypes=[wt.LPCWSTR,wt.HINSTANCE]
user32.CreateWindowExW.argtypes=[wt.DWORD,wt.LPCWSTR,wt.LPCWSTR,wt.DWORD,ct.c_int,ct.c_int,ct.c_int,ct.c_int,wt.HWND,wt.HANDLE,wt.HINSTANCE,ct.c_void_p]
user32.CreateWindowExW.restype=wt.HWND
user32.DefWindowProcW.argtypes=[wt.HWND,wt.UINT,wt.WPARAM,wt.LPARAM]
user32.DefWindowProcW.restype=ct.c_ssize_t
user32.DestroyWindow.argtypes=[wt.HWND]
user32.RegisterRawInputDevices.argtypes=[ct.POINTER(Device),wt.UINT,wt.UINT]
user32.RegisterRawInputDevices.restype=wt.BOOL
user32.GetRawInputData.argtypes=[wt.HANDLE,wt.UINT,ct.c_void_p,ct.POINTER(wt.UINT),wt.UINT]
user32.GetRawInputData.restype=wt.UINT

class RawInputListener:
    def __init__(self,emit):
        self.emit=emit;self.handle=None;self.active=False;self.error=None;self.registered=False
        self.instance=kernel32.GetModuleHandleW(None)
        self.name=f'EchoRecorder_{id(self):x}'

    def start(self):
        self.callback=WNDPROC(self.window_proc)
        window_class=WindowClass(proc=self.callback,instance=self.instance,name=self.name)
        try:
            if not user32.RegisterClassW(ct.byref(window_class)):
                raise RuntimeError(f'无法注册原始输入窗口（{ct.get_last_error()}）')
            self.registered=True
            self.handle=user32.CreateWindowExW(0,self.name,None,0,0,0,0,0,wt.HWND(-3),None,self.instance,None)
            if not self.handle:raise RuntimeError(f'无法创建原始输入窗口（{ct.get_last_error()}）')
            # INPUTSINK only: NOLEGACY/CAPTUREMOUSE would alter application input.
            devices=(Device*2)(Device(1,2,0x100,self.handle),Device(1,6,0x100,self.handle))
            if not user32.RegisterRawInputDevices(devices,2,ct.sizeof(Device)):
                raise RuntimeError(f'无法注册原始输入监听（{ct.get_last_error()}）')
            self.active=True
        except Exception as error:
            self.error=str(error);self.stop()
        return self.active

    def window_proc(self,handle,message,wparam,lparam):
        if message==0xFF:  # WM_INPUT
            try:self.read(lparam)
            except Exception as error:
                self.emit({'kind':'stop_request','reason':str(error),'traceback':traceback.format_exc()})
        # Windows releases foreground raw input resources here.
        return user32.DefWindowProcW(handle,message,wparam,lparam)

    def read(self,handle):
        size=wt.UINT()
        if user32.GetRawInputData(handle,0x10000003,None,ct.byref(size),ct.sizeof(Header))==0xFFFFFFFF:
            raise RuntimeError(f'无法读取原始输入长度（{ct.get_last_error()}）')
        if size.value<ct.sizeof(Header):raise RuntimeError('原始输入数据不完整')
        buffer=ct.create_string_buffer(max(size.value,ct.sizeof(Packet)))
        copied=user32.GetRawInputData(handle,0x10000003,buffer,ct.byref(size),ct.sizeof(Header))
        if copied==0xFFFFFFFF:raise RuntimeError(f'无法读取原始输入（{ct.get_last_error()}）')
        packet=ct.cast(buffer,ct.POINTER(Packet)).contents
        if packet.header.type==0:
            if copied<ct.sizeof(Header)+ct.sizeof(RawMouse):raise RuntimeError('原始鼠标数据不完整')
            mouse=packet.data.mouse
            self.emit({'kind':'raw_mouse','flags':mouse.flags,'data':mouse.data,'moving':bool(mouse.dx or mouse.dy),'extra':mouse.extra})
        elif packet.header.type==1:
            if copied<ct.sizeof(Header)+ct.sizeof(RawKey):raise RuntimeError('原始键盘数据不完整')
            key=packet.data.key
            if key.vk not in (0,255):self.emit({'kind':'raw_key','vk':key.vk,'up':bool(key.flags&1),'extra':key.extra})

    def stop(self):
        if self.active:
            devices=(Device*2)(Device(1,2,1,None),Device(1,6,1,None))
            user32.RegisterRawInputDevices(devices,2,ct.sizeof(Device))
        self.active=False
        if self.handle:user32.DestroyWindow(self.handle);self.handle=None
        if self.registered:user32.UnregisterClassW(self.name,self.instance);self.registered=False
