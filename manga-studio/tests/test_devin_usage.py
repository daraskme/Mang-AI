import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('devin_usage',Path(__file__).parents[1]/'python/devin-usage.py')
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
def number(n,v):return m.varint(n*8)+m.varint(v)
def reply(plan,info):return m.field(1,m.field(13,plan))+m.field(2,info)

class DevinUsageTests(unittest.TestCase):
    def test_max_weekly_and_reset_seconds(self):
        data=reply(number(14,100)+number(15,56)+number(17,1800000000)+number(18,1800600000),number(35,2)+number(36,1)+m.field(2,'Max'))
        result=m.parse_quota(data,123)
        self.assertEqual(result['plan'],'Max')
        self.assertEqual(result['quota']['windows'],[{'id':'weekly','label':'週次','minutes':10080,'remainingPercent':56,'resetsAt':1800600000}])
    def test_proto_zero_only_with_reset_and_non_quota_unavailable(self):
        result=m.parse_quota(reply(number(18,1800600000),number(35,2)+number(36,1)))
        self.assertEqual(result['quota']['windows'][0]['remainingPercent'],0)
        result=m.parse_quota(reply(b'',number(35,2)+number(36,1)))
        self.assertIsNone(result['quota']['windows'][0]['remainingPercent'])
        self.assertTrue(m.parse_quota(reply(number(15,99),number(35,1)))['quota']['unavailable'])
    def test_truncated_and_invalid_wire_rejected(self):
        for value in (b'\x0a\xff',b'\0',b'\x0e'):
            with self.assertRaises(ValueError):m.fields(value)

if __name__=='__main__':unittest.main()
