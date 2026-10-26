import datetime as dt, importlib.util, io, json, os, tarfile, tempfile, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('recovery',Path(__file__).parents[1]/'tools/buyer_recovery.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class RecoveryTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.previous=m.APP;m.APP=self.root/'app';m.APP.mkdir()
 def tearDown(self):m.APP=self.previous;self.temp.cleanup()
 def source(self):
  p=self.root/'saved';p.mkdir()
  for n,b in {'server.js':'//code','package.json':'{}','package-lock.json':'{}','data/database.json':json.dumps({'customers':[{'id':'kept'}]}),'data/users.json':'[]','.env':'OUTREACH_SEND_ENABLED=true\nSECRET=keep','uploads/cards/card.jpg':'picture'}.items():
   t=p/n;t.parent.mkdir(parents=True,exist_ok=True);t.write_text(b)
  m.write_json(p/'TTI_RECOVERY_MANIFEST.json',m.recovery_manifest(p));return p
 def test_verified_restore_preserves_data_and_disables_outreach(self):
  source=self.source();out=m.restore_folder(source,self.root/'restored')
  self.assertEqual(m.read_json(out/'data/database.json')['customers'][0]['id'],'kept');self.assertIn('SECRET=keep',(out/'.env').read_text());self.assertIn('OUTREACH_SEND_ENABLED=false',(out/'.env').read_text());m.verify_recovery(out)
  with self.assertRaises(ValueError):m.restore_folder(source,out)
 def test_corrupt_and_traversal_archives_rejected(self):
  source=self.source();(source/'data/database.json').write_text('{}')
  with self.assertRaises(ValueError):m.verify_recovery(source)
  b=io.BytesIO()
  with tarfile.open(fileobj=b,mode='w:gz') as t:
   info=tarfile.TarInfo('../outside');info.size=1;t.addfile(info,io.BytesIO(b'x'))
  with self.assertRaises(ValueError):m.unpack_recovery(b.getvalue(),self.root/'bad')
  self.assertFalse((self.root/'outside').exists())
 def test_monday_schedule_and_catchup(self):
  c={'hour':15,'minute':30};self.assertFalse(m.due(c,dt.datetime(2026,10,26,15,29)));self.assertTrue(m.due(c,dt.datetime(2026,10,27,9)))
  m.write_json(m.APP/'status.json',{'successful_week':'2026-10-26'});self.assertFalse(m.due(c,dt.datetime(2026,10,27,9)));self.assertTrue(m.due(c,dt.datetime(2026,11,2,15,30)))
  xml=m.task_xml(Path(r'C:\TTI Tools\agent.exe'),c,'S-1-5-21-test');self.assertIn('<Monday',xml);self.assertIn('StartWhenAvailable',xml);self.assertNotIn('powershell',xml.lower());self.assertIn('--scheduled',xml)
 @unittest.skipUnless(os.name=='nt','Windows DPAPI')
 def test_windows_credentials_roundtrip(self):self.assertEqual(m.protect(__import__('base64').b64decode(m.protect('test-only-not-a-real-password')),True),'test-only-not-a-real-password')

if __name__=='__main__':unittest.main()
