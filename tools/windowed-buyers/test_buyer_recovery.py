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
 def archive(self,links):
  source=self.source();out=io.BytesIO()
  with tarfile.open(fileobj=out,mode='w:gz') as t:
   for p in source.rglob('*'):
    if p.is_file():t.add(p,arcname=p.relative_to(source).as_posix(),recursive=False)
   for name,kind,target in links:
    info=tarfile.TarInfo(name);info.type=kind;info.linkname=target;t.addfile(info)
  return out.getvalue()
 def test_internal_links_become_plain_files(self):
  data=self.archive([('copy.js',tarfile.SYMTYPE,'server.js'),('data/copy.js',tarfile.SYMTYPE,'../server.js'),('hard.js',tarfile.LNKTYPE,'server.js')])
  out=self.root/'unpacked';m.unpack_recovery(data,out)
  for name in ['copy.js','data/copy.js','hard.js']:
   self.assertEqual((out/name).read_text(),'//code');self.assertFalse((out/name).is_symlink())
  m.verify_recovery(out)
 def test_external_links_still_rejected_with_name(self):
  data=self.archive([('bad-link',tarfile.SYMTYPE,'../../outside')])
  with self.assertRaisesRegex(ValueError,'bad-link'):m.unpack_recovery(data,self.root/'bad-link-output')
 def test_absolute_link_still_rejected(self):
  data=self.archive([('bad-link',tarfile.SYMTYPE,'/etc/passwd')])
  with self.assertRaisesRegex(ValueError,'bad-link'):m.unpack_recovery(data,self.root/'bad-absolute')
 def test_circular_links_rejected(self):
  data=self.archive([('a',tarfile.SYMTYPE,'b'),('b',tarfile.SYMTYPE,'a')])
  with self.assertRaisesRegex(ValueError,'Circular'):m.unpack_recovery(data,self.root/'bad-cycle')
 def client(self):
  c=m.Client.__new__(m.Client);c.base='https://buyers.example.test';c.auth='Basic test-only';return c
 def test_same_origin_307_download(self):
  from unittest.mock import patch,Mock
  from urllib.error import HTTPError
  response=io.BytesIO(b'backup bytes');opener=Mock()
  opener.open.side_effect=[HTTPError('https://buyers.example.test/start',307,'redirect',{'Location':'/download'},None),response]
  with patch.object(m.urllib.request,'build_opener',return_value=opener):
   self.assertEqual(self.client().get('/start'),b'backup bytes')
  self.assertEqual(opener.open.call_args_list[1].args[0].full_url,'https://buyers.example.test/download')
  self.assertEqual(opener.open.call_args_list[1].args[0].get_header('Authorization'),'Basic test-only')
 def test_redirect_credentials_cannot_leave_origin(self):
  from unittest.mock import patch,Mock
  from urllib.error import HTTPError
  for target in ['https://other.example.test/path','https://buyers.example.test:444/path','http://buyers.example.test/path','https://user:pass@buyers.example.test/path']:
   opener=Mock();opener.open.side_effect=HTTPError('https://buyers.example.test/start',307,'redirect',{'Location':target},None)
   with patch.object(m.urllib.request,'build_opener',return_value=opener):
    with self.assertRaises(RuntimeError):self.client().get('/start')
   self.assertEqual(opener.open.call_count,1)
 def test_redirect_loop_stops(self):
  from unittest.mock import patch,Mock
  from urllib.error import HTTPError
  opener=Mock();opener.open.side_effect=HTTPError('https://buyers.example.test/start',307,'redirect',{'Location':'/start'},None)
  with patch.object(m.urllib.request,'build_opener',return_value=opener):
   with self.assertRaisesRegex(RuntimeError,'loop'):self.client().get('/start')
  self.assertEqual(opener.open.call_count,6)
 def test_background_recovery_polls_then_downloads(self):
  from unittest.mock import Mock,patch
  client=Mock();job_id='11111111-1111-1111-1111-111111111111'
  client.json.side_effect=[{'id':job_id,'state':'preparing','progress':'Copying files'},{'id':job_id,'state':'ready'}]
  target=self.root/'archive';client.get.return_value=target
  with patch.object(m.time,'sleep') as sleep:
   self.assertEqual(m.download_recovery(client,target,lambda _:None),target)
  self.assertEqual(sleep.call_args.args,(5,));self.assertEqual(client.json.call_args_list[0].kwargs,{'method':'POST'})
  self.assertIn('/download',client.get.call_args.args[0]);self.assertEqual(client.get.call_args.kwargs['destination'],target)
 def test_background_recovery_two_hour_limit(self):
  from unittest.mock import Mock,patch
  client=Mock();client.json.return_value={'id':'11111111-1111-1111-1111-111111111111','state':'preparing'}
  with patch.object(m.time,'monotonic',side_effect=[0,7201]):
   with self.assertRaisesRegex(RuntimeError,'two-hour'):m.download_recovery(client,self.root/'archive',lambda _:None)
  client.get.assert_not_called()
 def test_large_download_streams_to_disk(self):
  from unittest.mock import Mock,patch
  payload=b'x'*(3*1024*1024+123)
  class Response(io.BytesIO):
   headers={'Content-Length':str(len(payload))}
   def read(self,size=-1):
    if size<0:raise AssertionError('Must not load whole archive into memory')
    return super().read(size)
  opener=Mock();opener.open.return_value=Response(payload)
  target=self.root/'archive'
  with patch.object(m.urllib.request,'build_opener',return_value=opener):
   self.client().get('/download',destination=target)
  self.assertEqual(target.read_bytes(),payload)
 def test_utf8_database_and_settings_roundtrip(self):
  source=self.source()
  customer='پاکستان “Buyer”'
  (source/'data/database.json').write_bytes(json.dumps({'customers':[{'name':customer}]},ensure_ascii=False).encode('utf-8'))
  (source/'.env').write_bytes(('LABEL='+customer+'\nOUTREACH_SEND_ENABLED=true').encode('utf-8'))
  m.write_json(source/'TTI_RECOVERY_MANIFEST.json',m.recovery_manifest(source))
  out=m.restore_folder(source,self.root/'unicode-restored')
  self.assertEqual(m.read_json(out/'data/database.json')['customers'][0]['name'],customer)
  self.assertIn(customer,(out/'.env').read_text(encoding='utf-8'))
 def test_current_folder_updates_and_keeps_previous(self):
  import shutil
  source=self.source();main=self.root/'main'
  m.publish_recovery(source,main)
  current=main/'Recovery'/'Current'
  staging=self.root/'second';shutil.copytree(current,staging)
  (staging/'server.js').write_bytes(b'//new code')
  m.write_json(staging/'TTI_RECOVERY_MANIFEST.json',m.recovery_manifest(staging))
  m.publish_recovery(staging,main)
  self.assertEqual((current/'server.js').read_bytes(),b'//new code')
  self.assertEqual((main/'Recovery'/'Previous'/'server.js').read_bytes(),b'//code')
  restored=m.restore_folder(main,self.root/'current-restored')
  self.assertEqual((restored/'server.js').read_bytes(),b'//new code')
 def test_invalid_update_preserves_current(self):
  import shutil
  source=self.source();main=self.root/'main';m.publish_recovery(source,main)
  current=main/'Recovery'/'Current';staging=self.root/'invalid';shutil.copytree(current,staging)
  (staging/'server.js').write_bytes(b'corrupt')
  with self.assertRaises(ValueError):m.publish_recovery(staging,main)
  m.verify_recovery(current);self.assertEqual((current/'server.js').read_bytes(),b'//code')
 def test_promotion_failure_rolls_back(self):
  from unittest.mock import patch
  import shutil
  source=self.source();main=self.root/'main';m.publish_recovery(source,main)
  current=main/'Recovery'/'Current';staging=self.root/'second';shutil.copytree(current,staging)
  original=m.os.replace
  def fail(src,dst):
   if Path(src)==staging:raise OSError('simulated locked folder')
   return original(src,dst)
  with patch.object(m.os,'replace',side_effect=fail):
   with self.assertRaises(OSError):m.publish_recovery(staging,main)
  m.verify_recovery(current)
 def test_completed_excel_is_kept_when_recovery_fails(self):
  from unittest.mock import patch
  import zipfile
  payload=io.BytesIO()
  with zipfile.ZipFile(payload,'w') as z:
   z.writestr('[Content_Types].xml','<Types/>');z.writestr('xl/workbook.xml','<workbook/>')
  data=payload.getvalue()
  class Client:
   def __init__(self,c):pass
   def json(self,route):return {'customers':[{'country':'Pakistan'}],'total':1}
   def get(self,route):return data
  out=self.root/'exports'
  with patch.object(m,'Client',Client),patch.object(m,'download_recovery',side_effect=RuntimeError('failed recovery')):
   with self.assertRaises(RuntimeError):m.run({'root':str(out),'recovery':True},lambda _:None)
  self.assertEqual((out/'Main'/'TTI_Customers.xlsx').read_bytes(),data)
  self.assertEqual(m.read_json(m.APP/'status.json')['state'],'FAILED')
 @unittest.skipUnless(os.name=='nt','Windows DPAPI')
 def test_windows_credentials_roundtrip(self):self.assertEqual(m.protect(__import__('base64').b64decode(m.protect('test-only-not-a-real-password')),True),'test-only-not-a-real-password')

if __name__=='__main__':unittest.main()
