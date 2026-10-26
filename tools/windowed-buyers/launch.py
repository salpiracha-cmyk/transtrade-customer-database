"""Readable launcher; displays and records startup failures."""
import os
import sys
import traceback
from pathlib import Path

def start():
    print('Python version:', sys.version.split()[0], flush=True)
    if sys.version_info < (3, 12):
        raise RuntimeError('Python 3.12 or newer is required. Install it from python.org.')
    try:
        import tkinter
    except ImportError:
        raise RuntimeError('Python needs Tcl/Tk. Modify your Python installation and enable Tcl/Tk and IDLE.') from None
    from buyer_recovery import main
    main()

if __name__ == '__main__':
    try:
        start()
    except Exception:
        details=traceback.format_exc()
        print('\nTTI could not start:\n'+details, file=sys.stderr, flush=True)
        try:
            folder=Path(os.environ.get('LOCALAPPDATA',str(Path.home())))/'Transtrade'/'BuyersWeekly'
            folder.mkdir(parents=True,exist_ok=True)
            log=folder/'startup-error.txt'
            log.write_text(details,encoding='utf-8')
            print('Error details saved to:', log, flush=True)
        except OSError:
            pass
        sys.exit(1)
