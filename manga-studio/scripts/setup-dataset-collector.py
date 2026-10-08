"""Install the collector into an isolated directory, separate from model runtimes."""
import argparse
from pathlib import Path
import subprocess
import sys

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[2]);a=p.parse_args()
    subprocess.run([sys.executable,'-m','pip','install','--target',str(a.root/'upstream/dataset-collector-runtime'),
                    '--requirement',str(Path(__file__).with_name('dataset-collector-requirements.txt'))],check=True)
