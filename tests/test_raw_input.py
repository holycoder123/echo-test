import ctypes as ct
import unittest
from unittest.mock import Mock,patch
from echo_test import raw_input as raw

class RawInputTests(unittest.TestCase):
    def test_windows_packet_layout_and_mouse_wheel_decode(self):
        self.assertEqual(ct.sizeof(raw.RawMouse),24)
        self.assertEqual(ct.sizeof(raw.Header),8+2*ct.sizeof(ct.c_void_p))
        packet=raw.Packet();packet.header.type=0;packet.header.size=ct.sizeof(packet)
        packet.data.mouse.flags=0x400;packet.data.mouse.data=0xFF88
        packet.data.mouse.dx=1
        emit=Mock();listener=raw.RawInputListener(emit)
        def read(handle,command,buffer,size,header):
            ct.cast(size,ct.POINTER(raw.wt.UINT)).contents.value=ct.sizeof(packet)
            if buffer is None:return 0
            ct.memmove(buffer,ct.byref(packet),ct.sizeof(packet));return ct.sizeof(packet)
        with patch.object(raw.user32,'GetRawInputData',side_effect=read):listener.read(10)
        event=emit.call_args.args[0]
        self.assertEqual(event['kind'],'raw_mouse');self.assertEqual(event['flags'],0x400)
        self.assertEqual(ct.c_short(event['data']).value,-120)
        self.assertTrue(event['moving'])

    def test_packet_failure_reports_original_reason_and_still_cleans_windows_input(self):
        emit=Mock();listener=raw.RawInputListener(emit)
        with patch.object(raw.user32,'GetRawInputData',return_value=0xFFFFFFFF), \
             patch.object(raw.user32,'DefWindowProcW',return_value=7) as cleanup:
            result=listener.window_proc(10,0xFF,0,1)
        self.assertEqual(result,7);cleanup.assert_called_once()
        self.assertEqual(emit.call_args.args[0]['kind'],'stop_request')
        self.assertIn('原始输入长度',emit.call_args.args[0]['reason'])
