"""TTI Windows buyer exports and verified recovery. Standard library only."""
import base64, ctypes, datetime as dt, hashlib, io, json, os, queue, re, shutil
import subprocess, sys, tarfile, tempfile, threading, time, urllib.request, urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path

APP = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'Transtrade' / 'BuyersWeekly'
DEFAULT_ROOT = r'E:\TTI DOCS\buyer list by APP'
DEFAULT_URL = 'https://buyers.transtradeinternational.com'
TASK = 'Transtrade Buyers Monday Export'
FIELDS = ('root','url','user','hour','minute','recovery')

def atomic(path, data):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+'.'+str(os.getpid())+'.part')
    tmp.write_bytes(data); os.replace(tmp,path)

def write_json(path,value): atomic(path,json.dumps(value,indent=2).encode())
def read_json(path,default=None):
    return json.loads(Path(path).read_text()) if Path(path).exists() else default

def protect(value, decrypt=False):
    if os.name!='nt': raise RuntimeError('Saved credentials require Windows.')
    from ctypes import wintypes
    class Blob(ctypes.Structure): _fields_=[('size',wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_ubyte))]
    raw=value if decrypt else value.encode('utf-8'); buf=ctypes.create_string_buffer(raw)
    src=Blob(len(raw),ctypes.cast(buf,ctypes.POINTER(ctypes.c_ubyte))); dst=Blob()
    dll=ctypes.WinDLL('crypt32',use_last_error=True)
    fn=dll.CryptUnprotectData if decrypt else dll.CryptProtectData
    fn.argtypes=[ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(Blob)]
    fn.restype=wintypes.BOOL
    if not fn(ctypes.byref(src),None,None,None,None,1,ctypes.byref(dst)): raise ctypes.WinError(ctypes.get_last_error())
    try: result=ctypes.string_at(dst.data,dst.size)
    finally:
        kernel=ctypes.WinDLL('kernel32'); kernel.LocalFree.argtypes=[ctypes.c_void_p]; kernel.LocalFree(ctypes.cast(dst.data,ctypes.c_void_p))
    return result.decode('utf-8') if decrypt else base64.b64encode(result).decode('ascii')

def config(password=None, values=None):
    current=read_json(APP/'config.json',{})
    if values is not None:
        current.update({k:values[k] for k in FIELDS})
        if password: current['secret']=protect(password)
        if not current.get('secret'): raise ValueError('Enter the website password once.')
        write_json(APP/'config.json',current)
    return current

class Client:
    def __init__(self,c):
        self.base=c['url'].rstrip('/')
        if urllib.parse.urlparse(self.base).scheme!='https': raise ValueError('Website URL must use HTTPS.')
        pwd=protect(base64.b64decode(c['secret']),True)
        self.auth='Basic '+base64.b64encode((c['user']+':'+pwd).encode()).decode()
    def get(self,route):
        req=urllib.request.Request(self.base+route,headers={'Authorization':self.auth,'User-Agent':'TTI-Buyers-Weekly/1.0'})
        # Never follow a redirect with the login header to another host.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*args,**kwargs): return None
        for attempt in range(3):
            try:
                with urllib.request.build_opener(NoRedirect).open(req,timeout=180) as r: return r.read()
            except urllib.error.HTTPError as e:
                if e.code in (401,403): raise RuntimeError('Login rejected. Open Settings and enter a current administrator login.') from None
                if attempt==2: raise RuntimeError('Website request failed (HTTP '+str(e.code)+').') from None
            except (OSError,TimeoutError):
                if attempt==2: raise RuntimeError('Website connection failed. Check internet and try again.') from None
            time.sleep(2**attempt)
    def json(self,route): return json.loads(self.get(route))

def safe_name(value):
    name=re.sub(r'[<>:"/\\|?*\x00-\x1f]',' ',str(value)).strip(' .')[:90]
    if not name or name.upper() in {'CON','PRN','AUX','NUL',*(f'COM{i}' for i in range(10)),*(f'LPT{i}' for i in range(10))}: raise ValueError('Invalid country folder name: '+str(value))
    return name

def validate_xlsx(data):
    import zipfile
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        if '[Content_Types].xml' not in z.namelist() or 'xl/workbook.xml' not in z.namelist(): raise ValueError('Website returned an invalid Excel workbook.')
        if z.testzip(): raise ValueError('Excel workbook is corrupt.')

def recovery_manifest(root):
    root=Path(root)
    required=['server.js','package.json','package-lock.json','data/database.json','data/users.json']
    for item in required:
        if not (root/item).is_file(): raise ValueError('Recovery is incomplete: missing '+item)
    db=read_json(root/'data/database.json')
    if not isinstance(db.get('customers'),list): raise ValueError('Invalid customer database.')
    files={}
    for p in root.rglob('*'):
        if p.is_symlink(): raise ValueError('Recovery cannot contain symbolic links.')
        if p.is_file() and p.name!='TTI_RECOVERY_MANIFEST.json': files[p.relative_to(root).as_posix()]=hashlib.sha256(p.read_bytes()).hexdigest()
    return {'format':'TTI-BUYERS-RECOVERY-1','created':dt.datetime.now().isoformat(),'files':files,'customers':len(db['customers'])}

def unpack_recovery(data,destination):
    # Convert valid in-archive links to ordinary files/directories. Never create
    # filesystem links or follow a link outside the validated archive namespace.
    import posixpath
    destination=Path(destination); destination.mkdir(parents=True,exist_ok=True)
    if any(destination.iterdir()):raise ValueError('Recovery staging folder must be empty.')
    def normalize(name, context):
        if not name or name.startswith('/') or '\\' in name or ':' in name:
            raise ValueError('Unsafe recovery path: '+context)
        result=posixpath.normpath(name)
        if result=='..' or result.startswith('../'):
            raise ValueError('Recovery path escapes the backup folder: '+context)
        return result
    with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as t:
        entries={}
        for m in t.getmembers():
            name=normalize(m.name,m.name)
            if not (m.isfile() or m.isdir() or m.issym() or m.islnk()):
                raise ValueError('Unsupported recovery entry: '+m.name+' (type '+repr(m.type)+')')
            if name=='.' and not m.isdir():raise ValueError('Invalid recovery root entry: '+m.name)
            entries[name]=m
        def resolve(name,seen=None):
            seen=set() if seen is None else seen
            if name in seen:raise ValueError('Circular recovery link: '+name)
            seen.add(name)
            m=entries.get(name)
            if m is None:raise ValueError('Recovery link target is missing: '+name)
            if m.issym() or m.islnk():
                if m.linkname.startswith('/') or '\\' in m.linkname or ':' in m.linkname:raise ValueError('Unsafe recovery link: '+m.name+' -> '+m.linkname)
                link=m.linkname
                # Relative symbolic links are relative to the link's parent.
                # Re-normalize the joined path; hard links use archive-root paths.
                if m.issym():
                    link=normalize(posixpath.join(posixpath.dirname(name),m.linkname),m.name+' -> '+m.linkname)
                else:link=normalize(link,m.name+' -> '+m.linkname)
                return resolve(link,seen)
            return name,m
        # Validate link targets and parent paths before writing any contents.
        for name,m in entries.items():
            parent=posixpath.dirname(name)
            while parent and parent!='.':
                if parent in entries and not entries[parent].isdir():
                    raise ValueError('Recovery entry has a non-directory parent: '+name)
                parent=posixpath.dirname(parent)
            if m.issym() or m.islnk():resolve(name)
        def copy_entry(name,m,target,seen=None):
            seen=set() if seen is None else seen
            if name in seen:raise ValueError('Circular recovery directory link: '+name)
            seen=seen|{name}
            if m.issym() or m.islnk():
                original,resolved=resolve(name)
                if m.islnk() and not resolved.isfile():raise ValueError('Invalid recovery hard link: '+name)
                return copy_entry(original,resolved,target,seen)
            if m.isdir():
                target.mkdir(parents=True,exist_ok=True)
                for child,info in entries.items():
                    if child!='.' and posixpath.dirname(child)==('' if name=='.' else name):
                        copy_entry(child,info,target/posixpath.basename(child),seen)
            elif m.isfile():
                target.parent.mkdir(parents=True,exist_ok=True)
                source=t.extractfile(m)
                if source is None:raise ValueError('Unreadable recovery file: '+name)
                with source, target.open('wb') as out:shutil.copyfileobj(source,out)
        # Explicit top-level items also cover archives without a '.' entry.
        for name,m in entries.items():
            if name!='.' and not posixpath.dirname(name):copy_entry(name,m,destination/name)
        # Some tar producers omit directory entries. Copy such ordinary files too.
        for name,m in entries.items():
            if name!='.' and not (destination/name).exists():copy_entry(name,m,destination/name)
    manifest=recovery_manifest(destination); write_json(destination/'TTI_RECOVERY_MANIFEST.json',manifest)
    return manifest

def verify_recovery(folder):
    folder=Path(folder); manifest=read_json(folder/'TTI_RECOVERY_MANIFEST.json')
    if not manifest or manifest.get('format')!='TTI-BUYERS-RECOVERY-1': raise ValueError('Select a recovery snapshot folder containing TTI_RECOVERY_MANIFEST.json.')
    for name,digest in manifest['files'].items():
        p=(folder/name).resolve()
        if not p.is_relative_to(folder.resolve()) or not p.is_file() or p.is_symlink(): raise ValueError('Missing or unsafe file: '+name)
        if hashlib.sha256(p.read_bytes()).hexdigest()!=digest: raise ValueError('Recovery checksum mismatch: '+name)
    recovery_manifest(folder)
    return manifest

def restore_folder(source,target):
    source=Path(source).resolve(); target=Path(target).resolve()
    if not (source/'TTI_RECOVERY_MANIFEST.json').is_file():
        choices=sorted((source/'Recovery'/'Snapshots').glob('*/TTI_RECOVERY_MANIFEST.json'),reverse=True)
        if not choices: raise ValueError('No full recovery snapshot found in this main folder. Select a dated recovery snapshot or the main buyer-save folder.')
        source=choices[0].parent
    verify_recovery(source)
    if target==source or target.is_relative_to(source) or source.is_relative_to(target): raise ValueError('Choose a separate empty destination folder.')
    if target.exists() and any(target.iterdir()): raise ValueError('Destination must be empty. Existing data will never be overwritten.')
    target.mkdir(parents=True,exist_ok=True)
    shutil.copytree(source,target,dirs_exist_ok=True); verify_recovery(target)
    # Prevent old queued campaigns from sending after recovery boot.
    env=target/'.env'; content=env.read_text() if env.exists() else ''
    content=re.sub(r'^OUTREACH_SEND_ENABLED=.*$', 'OUTREACH_SEND_ENABLED=false',content,flags=re.M)
    if not re.search(r'^OUTREACH_SEND_ENABLED=',content,re.M): content+='\nOUTREACH_SEND_ENABLED=false\n'
    env.write_text(content)
    write_json(target/'TTI_RECOVERY_MANIFEST.json',recovery_manifest(target))
    return target

def due(c,today=None):
    today=today or dt.datetime.now(); monday=today.date()-dt.timedelta(days=today.weekday())
    when=dt.datetime.combine(monday,dt.time(int(c['hour']),int(c['minute'])))
    status=read_json(APP/'status.json',{})
    return today>=when and status.get('successful_week')!=monday.isoformat()

def run(c,emit=print):
    root=Path(c['root']); root.mkdir(parents=True,exist_ok=True)
    # OS lock is released automatically on process exit, including crashes.
    lock=open(APP/'run.lock','a+b')
    if os.name=='nt':
        import msvcrt
        lock.seek(0);lock.write(b'0');lock.flush();lock.seek(0)
        try: msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
        except OSError: lock.close();raise RuntimeError('Another save is already running.')
    def log(msg):
        line=dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')+' '+msg
        with (APP/'activity.log').open('a',encoding='utf-8') as f:f.write(line+'\n')
        emit(msg)
    try:
        log('Connecting to buyers website…'); client=Client(c); client.json('/api/summary')
        countries=set(); offset=0
        while True:
            page=client.json('/api/customers?category=buyer&limit=1000&offset='+str(offset))
            for row in page['customers']:
                for country in re.split(r'\s*;\s*|\s+/\s+',row.get('country','')):
                    if country.strip():countries.add(country.strip())
            offset+=len(page['customers'])
            if offset>=page['total']:break
            if not page['customers']:raise ValueError('Incomplete contact list returned.')
        if not countries:raise ValueError('No active buyer countries returned; previous files kept.')
        with tempfile.TemporaryDirectory(prefix='.tti-save-',dir=root) as stage:
            stage=Path(stage); paths=[('Main/TTI_Customers.xlsx','/api/export.xlsx?category=buyer'),('Review/Review.xlsx','/api/export.xlsx?category=review'),('Traders/Traders.xlsx','/api/export.xlsx?category=trader')]
            names=set()
            for country in sorted(countries):
                name=safe_name(country)
                if name.casefold() in names or name.casefold() in {'main','review','traders','recovery'}:raise ValueError('Country folder collision: '+country)
                names.add(name.casefold());paths.append((name+'/'+name+'.xlsx','/api/export.xlsx?category=buyer&country='+urllib.parse.quote(country)))
            for index,(name,route) in enumerate(paths,1):
                log('Saving Excel '+str(index)+'/'+str(len(paths))+': '+name)
                data=client.get(route);validate_xlsx(data);atomic(stage/name,data)
            recovery=None
            if c.get('recovery',True):
                log('Downloading full software, database, users, cards and settings…')
                data=client.get('/api/admin/recovery.tar.gz')
                recovery=stage/'recovery-content';unpack_recovery(data,recovery)
            # Publish only after ALL requested downloads and validation succeeded.
            for name,_ in paths:atomic(root/name,(stage/name).read_bytes())
            if recovery:
                snapshots=root/'Recovery'/'Snapshots';snapshots.mkdir(parents=True,exist_ok=True)
                shutil.move(str(recovery),str(snapshots/dt.datetime.now().strftime('%Y-%m-%d_%H%M%S')))
        now=dt.datetime.now();monday=now.date()-dt.timedelta(days=now.weekday())
        write_json(APP/'status.json',{'state':'SUCCESS','time':now.isoformat(),'successful_week':monday.isoformat(),'root':str(root),'files':len(paths),'full_recovery':bool(c.get('recovery'))})
        log('SUCCESS — '+str(len(paths))+' Excel files saved to '+str(root));return True
    except Exception as e:
        previous=read_json(APP/'status.json',{});previous.update(state='FAILED',error=str(e),time=dt.datetime.now().isoformat());write_json(APP/'status.json',previous)
        log('FAILED — '+str(e));raise
    finally:lock.close()

def task_xml(exe,c,sid,script=None):
    ns='http://schemas.microsoft.com/windows/2004/02/mit/task';ET.register_namespace('',ns)
    def add(parent,name,value=None):
        node=ET.SubElement(parent,'{'+ns+'}'+name)
        if value is not None:node.text=str(value)
        return node
    task=ET.Element('{'+ns+'}Task',version='1.2'); triggers=add(task,'Triggers')
    weekly=add(triggers,'CalendarTrigger');add(weekly,'StartBoundary','2026-01-05T%02d:%02d:00'%(int(c['hour']),int(c['minute'])));add(weekly,'Enabled','true')
    sched=add(weekly,'ScheduleByWeek');add(sched,'WeeksInterval','1');add(add(sched,'DaysOfWeek'),'Monday')
    login=add(triggers,'LogonTrigger');add(login,'Enabled','true');add(login,'UserId',sid)
    principal=add(add(task,'Principals'),'Principal');principal.set('id','Author');add(principal,'UserId',sid);add(principal,'LogonType','InteractiveToken');add(principal,'RunLevel','LeastPrivilege')
    settings=add(task,'Settings')
    for k,v in [('MultipleInstancesPolicy','IgnoreNew'),('DisallowStartIfOnBatteries','false'),('StopIfGoingOnBatteries','false'),('StartWhenAvailable','true'),('RunOnlyIfNetworkAvailable','true'),('ExecutionTimeLimit','PT4H'),('Enabled','true')]:add(settings,k,v)
    restart=add(settings,'RestartOnFailure');add(restart,'Interval','PT15M');add(restart,'Count','3')
    arguments=subprocess.list2cmdline([str(script),'--scheduled']) if script else '--scheduled'
    actions=add(task,'Actions');actions.set('Context','Author');action=add(actions,'Exec');add(action,'Command',str(exe));add(action,'Arguments',arguments);add(action,'WorkingDirectory',str(APP))
    # schtasks reads the declaration as well as the BOM. Match the UTF-16
    # file written by install(); encoding='unicode' declares UTF-8 instead.
    return ET.tostring(task,encoding='utf-16',xml_declaration=True).decode('utf-16')

def install(c):
    if os.name!='nt':raise RuntimeError('Schedule setup requires Windows.')
    if sys.version_info<(3,12):raise RuntimeError('Please install Python 3.12 or newer from python.org.')
    APP.mkdir(parents=True,exist_ok=True)
    source=Path(__file__).read_bytes()
    version=hashlib.sha256(source).hexdigest()[:16]
    target=APP/'versions'/version/'buyer_recovery.py'
    target.parent.mkdir(parents=True,exist_ok=True)
    if not target.exists() or target.read_bytes()!=source:atomic(target,source)
    interpreter=Path(sys.executable).resolve()
    if interpreter.name.lower()=='python.exe' and interpreter.with_name('pythonw.exe').is_file():
        interpreter=interpreter.with_name('pythonw.exe')
    import csv
    row=next(csv.reader(subprocess.check_output(['whoami','/user','/fo','csv','/nh'],creationflags=0x08000000,text=True).splitlines()))
    sid=row[-1].strip();xml=target.parent/'schedule.xml';xml.write_text(task_xml(interpreter,c,sid,target),encoding='utf-16')
    result=subprocess.run(['schtasks','/Create','/TN',TASK,'/XML',str(xml),'/F'],capture_output=True,text=True,creationflags=0x08000000)
    if result.returncode:raise RuntimeError('Task installation failed: '+result.stderr.strip())
    check=subprocess.run(['schtasks','/Query','/TN',TASK,'/XML'],capture_output=True,text=True,creationflags=0x08000000)
    if check.returncode:raise RuntimeError('Task could not be verified.')
    # Retire only the known old upload-to-live task, after replacement is verified.
    subprocess.run(['schtasks','/Change','/TN','Transtrade Customer Database Weekly Sync','/DISABLE'],capture_output=True,creationflags=0x08000000)
    return 'Monday schedule installed and verified. Keep this Windows user signed in. Missed saves run after the next sign-in.'

def gui():
    import tkinter as tk
    from tkinter import ttk,filedialog,messagebox
    APP.mkdir(parents=True,exist_ok=True);root=tk.Tk();root.title('TTI Buyers — Weekly Saves and Recovery');root.geometry('850x660')
    c=config();frame=ttk.Frame(root,padding=18);frame.pack(fill='both',expand=True)
    ttk.Label(frame,text='Buyer database: automatic Monday saves',font=('Segoe UI',16,'bold')).pack(anchor='w')
    ttk.Label(frame,text='No PowerShell. Setup registers the schedule automatically. Your website is never overwritten by a scheduled save.').pack(anchor='w',pady=8)
    form=ttk.Frame(frame);form.pack(fill='x');vars={}
    for i,(key,label,default) in enumerate([('root','Save folder',DEFAULT_ROOT),('url','Website',DEFAULT_URL),('user','Login ID','tti'),('password','Password (leave blank to keep saved)',''),('hour','Monday hour (24-hour)',15),('minute','Minute',30)]):
        ttk.Label(form,text=label).grid(row=i,column=0,sticky='w',padx=4,pady=4);v=tk.StringVar(value=str(c.get(key,default)) if key!='password' else '');vars[key]=v
        ttk.Entry(form,textvariable=v,show='*' if key=='password' else '',width=66).grid(row=i,column=1,sticky='ew',padx=4,pady=4)
    form.columnconfigure(1,weight=1)
    ttk.Button(form,text='Choose folder…',command=lambda:vars['root'].set(filedialog.askdirectory() or vars['root'].get())).grid(row=0,column=2)
    full=tk.BooleanVar(value=c.get('recovery',True));ttk.Checkbutton(frame,text='Also save full recovery snapshots (software, all data, cards, users and server settings)',variable=full).pack(anchor='w',pady=8)
    ttk.Label(frame,text='The PC must be on and this Windows user signed in. Missed Monday jobs catch up at the next sign-in.').pack(anchor='w')
    output=tk.Text(frame,height=13,wrap='word');output.pack(fill='both',expand=True,pady=8);messages=queue.Queue();busy=False
    def emit(t):messages.put(str(t))
    def poll():
        while not messages.empty():output.insert('end',messages.get()+'\n');output.see('end')
        root.after(150,poll)
    def work(fn):
        nonlocal busy
        if busy:messagebox.showinfo('Running','Wait for the current operation to finish.');return
        busy=True
        def runner():
            nonlocal busy
            try:fn()
            except Exception as e:emit('ERROR: '+str(e))
            finally:busy=False
        threading.Thread(target=runner,daemon=True).start()
    def save():
        values={k:vars[k].get().strip() for k in ['root','url','user','hour','minute']};values['recovery']=full.get()
        if not values['root'] or not values['user']:raise ValueError('Choose the destination and login ID.')
        if not 0<=int(values['hour'])<24 or not 0<=int(values['minute'])<60:raise ValueError('Enter a valid time.')
        return config(vars['password'].get(),values)
    def setup():
        try:current=save()
        except Exception as e:messagebox.showerror('Settings',str(e));return
        def job():
            emit('Checking connection…');Client(current).json('/api/summary');emit(install(current));run(current,emit)
        work(job)
    def save_now():
        try:current=save()
        except Exception as e:messagebox.showerror('Settings',str(e));return
        work(lambda:run(current,emit))
    def restore():
        source=filedialog.askdirectory(title='Select main buyer-save folder or a dated Recovery snapshot')
        if not source:return
        target=filedialog.askdirectory(title='Select EMPTY destination for restored software and data')
        if not target:return
        if messagebox.askyesno('Restore to empty folder','Verify and copy the complete recovery into '+target+'? Existing files will not be overwritten. This does not upload to or change the live website.'):
            work(lambda:emit('RESTORE COMPLETE: '+str(restore_folder(source,target))+' — read RECOVERY_README.txt before starting on new hosting.'))
    buttons=ttk.Frame(frame);buttons.pack(fill='x')
    for label,fn in [('Install / Update Monday Setup',setup),('Save Now',save_now),('Restore Saved Folder',restore),('Open Save Folder',lambda:os.startfile(vars['root'].get())),('Open Logs',lambda:os.startfile(str(APP)))]:ttk.Button(buttons,text=label,command=fn).pack(side='left',padx=3)
    emit('Last result: '+json.dumps(read_json(APP/'status.json',{'state':'Not yet run'})))
    emit('Log and status folder: '+str(APP));poll()
    def close():
        if busy:messagebox.showinfo('Save running','Please let this operation finish before closing.');return
        root.destroy()
    root.protocol('WM_DELETE_WINDOW',close);root.mainloop()

def main():
    APP.mkdir(parents=True,exist_ok=True)
    if '--scheduled' in sys.argv:
        try:
            c=config()
            if due(c):run(c,lambda _:None)
        except Exception:sys.exit(1)
    else:gui()

if __name__=='__main__':main()
