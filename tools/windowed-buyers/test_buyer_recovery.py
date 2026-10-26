import datetime as dt, importlib.util, io, json, os, tarfile, tempfile, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('recovery',Path(__file__).with_name('buyer_recovery.py'))
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
 def test_main_folder_restores_latest_snapshot(self):
  import shutil
  source=self.source();main=self.root/'main';snap=main/'Recovery'/'Snapshots'/'2026-10-26_153000';snap.parent.mkdir(parents=True);shutil.copytree(source,snap)
  result=m.restore_folder(main,self.root/'from-main');self.assertTrue((result/'data/database.json').exists())
 def test_monday_schedule_and_catchup(self):
  c={'hour':15,'minute':30};self.assertFalse(m.due(c,dt.datetime(2026,10,26,15,29)));self.assertTrue(m.due(c,dt.datetime(2026,10,27,9)))
  m.write_json(m.APP/'status.json',{'successful_week':'2026-10-26'});self.assertFalse(m.due(c,dt.datetime(2026,10,27,9)));self.assertTrue(m.due(c,dt.datetime(2026,11,2,15,30)))
  xml=m.task_xml(Path(r'C:\TTI Tools\agent.exe'),c,'S-1-5-21-test');self.assertIn('<Monday',xml);self.assertIn('StartWhenAvailable',xml);self.assertNotIn('powershell',xml.lower());self.assertIn('--scheduled',xml)
 def test_script_install_uses_python_and_preserves_config(self):
  from unittest.mock import patch
  from types import SimpleNamespace
  interpreter=self.root/'Python Folder'/'python.exe';interpreter.parent.mkdir();interpreter.touch();interpreter.with_name('pythonw.exe').touch()
  m.write_json(m.APP/'config.json',{'keep':'settings'})
  legacy=m.APP/'buyer_recovery.py';legacy.write_text('old copy');legacy.chmod(0o444)
  c={'hour':15,'minute':30}
  with patch.object(m,'os',SimpleNamespace(name='nt',getpid=os.getpid,replace=os.replace)), patch.object(m.sys,'executable',str(interpreter)), patch.object(m.subprocess,'check_output',return_value='"testuser","S-1-5-21-test"'), patch.object(m.subprocess,'run',return_value=SimpleNamespace(returncode=0,stderr='')) as call:
   try:m.install(c)
   finally:legacy.chmod(0o666)
  self.assertEqual(legacy.read_text(),'old copy')
  installed=next((m.APP/'versions').glob('*/buyer_recovery.py'))
  xml=installed.with_name('schedule.xml').read_text(encoding='utf-16')
  import xml.etree.ElementTree as ET
  # Parse actual bytes: parsing decoded text hides declaration/BOM mismatches.
  raw=installed.with_name('schedule.xml').read_bytes()
  self.assertTrue(raw.startswith((b'\xff\xfe',b'\xfe\xff')))
  self.assertIn("encoding='utf-16'",xml)
  tree=ET.fromstring(raw);ns={'t':'http://schemas.microsoft.com/windows/2004/02/mit/task'}
  self.assertEqual(tree.find('.//t:Command',ns).text,str(interpreter.resolve().with_name('pythonw.exe')))
  self.assertEqual(tree.find('.//t:Arguments',ns).text,m.subprocess.list2cmdline([str(installed),'--scheduled']))
  self.assertTrue(installed.is_file());self.assertEqual(m.read_json(m.APP/'config.json'),{'keep':'settings'})
  self.assertEqual(call.call_args_list[0].args[0][1],'/Create');self.assertEqual(call.call_args_list[1].args[0][1],'/Query')
 def test_failed_download_preserves_existing_export(self):
  from unittest.mock import patch
  out=self.root/'exports';old=out/'Main'/'TTI_Customers.xlsx';old.parent.mkdir(parents=True);old.write_bytes(b'original')
  class BrokenClient:
   def __init__(self,c):pass
   def json(self,route):return {'customers':[{'country':'Pakistan'}],'total':1}
   def get(self,route):raise RuntimeError('test network failure')
  with patch.object(m,'Client',BrokenClient):
   with self.assertRaises(RuntimeError):m.run({'root':str(out)},lambda _:None)
  self.assertEqual(old.read_bytes(),b'original');self.assertEqual(m.read_json(m.APP/'status.json')['state'],'FAILED')
 @unittest.skipUnless(os.name=='nt','Windows DPAPI')
 def test_windows_credentials_roundtrip(self):self.assertEqual(m.protect(__import__('base64').b64decode(m.protect('test-only-not-a-real-password')),True),'test-only-not-a-real-password')

if __name__=='__main__':unittest.main()
