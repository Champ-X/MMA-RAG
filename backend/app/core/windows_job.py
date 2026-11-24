"""Tie Windows service descendants to their supervisor's lifetime."""
from __future__ import annotations

import ctypes
from ctypes import wintypes


def contain_process_tree() -> int:
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    size = ctypes.c_size_t

    class Limits(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_longlong), ("PerJobUserTimeLimit", ctypes.c_longlong),
            ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", size), ("MaximumWorkingSetSize", size),
            ("ActiveProcessLimit", wintypes.DWORD), ("Affinity", size), ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class Extended(ctypes.Structure):
        _fields_ = [("BasicLimitInformation", Limits), ("IoInfo", ctypes.c_ulonglong * 6),
                    ("ProcessMemoryLimit", size), ("JobMemoryLimit", size),
                    ("PeakProcessMemoryUsed", size), ("PeakJobMemoryUsed", size)]

    kernel.CreateJobObjectW.argtypes = [wintypes.LPVOID, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    job = kernel.CreateJobObjectW(None, None)
    if not job:
        raise ctypes.WinError(ctypes.get_last_error())
    limits = Extended()
    limits.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not (kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits))
            and kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess())):
        error = ctypes.get_last_error()
        kernel.CloseHandle(job)
        raise ctypes.WinError(error)
    # Non-inheritable handle. The OS closes it when this process exits, including hard kills.
    return job
