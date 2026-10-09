import importlib.util
from pathlib import Path
import unittest
import http.client, io, tempfile, tomllib
from unittest.mock import patch
from urllib.parse import urlsplit

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
    def test_native_identity_is_preserved_and_private_scratch_is_removed(self):
        base=Path(__file__).parents[1]/'.test-output';base.mkdir(exist_ok=True)
        payload=reply(number(15,42)+number(18,1800600000),number(35,2)+number(36,1)+m.field(2,'Max'))
        calls=[];test=self
        class Opener:
            def open(self,request,timeout):
                test.assertEqual(request.full_url,m.ENDPOINT)
                test.assertEqual(request.get_header('Authorization'),'Bearer synthetic-proof')
                test.assertEqual(m.fields(m.fields(request.data)[1])[31],b'synthetic-proof')
                calls.append(request);response=io.BytesIO(payload);response.status=200;return response
        class NativeCLI:
            def __init__(self,args,**kwargs):
                test.assertEqual(args,['synthetic-cli','auth','status'])
                file=Path(kwargs['env']['XDG_DATA_HOME'])/'devin/credentials.toml'
                test.assertEqual(file.stat().st_mode&0o777,0o600)
                cred=tomllib.loads(file.read_text());test.assertEqual(cred['windsurf_api_key'],'synthetic-key')
                uri=urlsplit(cred['api_server_url']);connection=http.client.HTTPConnection(uri.hostname,uri.port)
                connection.request('POST','/unexpected',body=b'no');test.assertEqual(connection.getresponse().status,404);connection.close()
                connection=http.client.HTTPConnection(uri.hostname,uri.port)
                body=m.field(1,m.field(3,'synthetic-key')+m.field(31,'synthetic-proof'))
                connection.request('POST',urlsplit(m.ENDPOINT).path,body=body,headers={'Authorization':'Bearer synthetic-proof','Content-Type':'application/proto'})
                response=connection.getresponse();test.assertEqual(response.status,200);response.read();connection.close()
            def wait(self,timeout=None):return 0
            def poll(self):return 0
        with tempfile.TemporaryDirectory(dir=base) as directory:
            credential=Path(directory)/'credentials.toml'
            original='windsurf_api_key = "synthetic-key"\napi_server_url = "https://server.codeium.com"\n'
            credential.write_text(original)
            with patch.object(m.urllib.request,'build_opener',return_value=Opener()),patch.object(m.subprocess,'Popen',NativeCLI):
                result=m.read_usage(credential,'synthetic-cli')
            self.assertEqual(result['quota']['windows'][0]['remainingPercent'],42)
            self.assertEqual(credential.read_text(),original)
            self.assertEqual(list(Path(directory).iterdir()),[credential])
            self.assertEqual(len(calls),1)

if __name__=='__main__':unittest.main()
