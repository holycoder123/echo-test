"""Keep script descendants in a job that closes with the script step."""
import ctypes as ct
from ctypes import wintypes as wt


class BasicLimits(ct.Structure):
    _fields_ = [('process_time', ct.c_longlong), ('job_time', ct.c_longlong),
                ('flags', wt.DWORD), ('minimum_working_set', ct.c_size_t),
                ('maximum_working_set', ct.c_size_t), ('active_processes', wt.DWORD),
                ('affinity', ct.c_size_t), ('priority', wt.DWORD), ('scheduling', wt.DWORD)]


class IoCounters(ct.Structure):
    _fields_ = [(name, ct.c_ulonglong) for name in
                ('read_operations', 'write_operations', 'other_operations', 'read_bytes', 'write_bytes', 'other_bytes')]


class ExtendedLimits(ct.Structure):
    _fields_ = [('basic', BasicLimits), ('io', IoCounters), ('process_memory', ct.c_size_t),
                ('job_memory', ct.c_size_t), ('peak_process_memory', ct.c_size_t), ('peak_job_memory', ct.c_size_t)]


class ScriptProcessJob:
    def __init__(self, process):
        self.kernel = ct.WinDLL('kernel32', use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [ct.c_void_p, wt.LPCWSTR]
        self.kernel.CreateJobObjectW.restype = wt.HANDLE
        self.kernel.SetInformationJobObject.argtypes = [wt.HANDLE, ct.c_int, ct.c_void_p, wt.DWORD]
        self.kernel.AssignProcessToJobObject.argtypes = [wt.HANDLE, wt.HANDLE]
        self.kernel.CloseHandle.argtypes = [wt.HANDLE]
        self.handle = self.kernel.CreateJobObjectW(None, None)
        if not self.handle:
            raise ct.WinError(ct.get_last_error())
        try:
            limits = ExtendedLimits()
            limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if not self.kernel.SetInformationJobObject(self.handle, 9, ct.byref(limits), ct.sizeof(limits)):
                raise ct.WinError(ct.get_last_error())
            if not self.kernel.AssignProcessToJobObject(self.handle, int(process._handle)):
                raise ct.WinError(ct.get_last_error())
        except Exception:
            self.close()
            raise

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None
