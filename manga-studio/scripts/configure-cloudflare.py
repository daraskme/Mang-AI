"""Prepare an Access-protected named Tunnel and user services; never opens a port."""
import argparse,json,re,shutil
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]

def prepare(args):
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?',args.hostname) or '.' not in args.hostname:
        raise ValueError('hostname must be a DNS hostname without a scheme or path')
    team=args.team.removesuffix('.cloudflareaccess.com')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]*',team):raise ValueError('Invalid Cloudflare team name')
    if not re.fullmatch(r'[a-fA-F0-9]{64}',args.aud):raise ValueError('AUD must be the 64-character Access Application Audience tag')
    if not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',args.tunnel):raise ValueError('Invalid tunnel UUID')
    if not 1024<=args.port<=65535:raise ValueError('Port must be 1024..65535')
    credentials=Path(args.credentials or Path.home()/'.cloudflared'/f'{args.tunnel}.json').resolve()
    if not credentials.is_file():raise ValueError('Tunnel credentials file is missing; run cloudflared tunnel create first')
    if json.loads(credentials.read_text()).get('TunnelID')!=args.tunnel:raise ValueError('Credentials belong to another Tunnel')
    cloudflared=Path(args.cloudflared or shutil.which('cloudflared') or '').resolve()
    if not cloudflared.is_file():raise ValueError('Set --cloudflared to the installed cloudflared executable')
    config={'tunnel':args.tunnel,'credentials-file':str(credentials),'ingress':[{'hostname':args.hostname,'service':f'http://127.0.0.1:{args.port}','originRequest':{'httpHostHeader':args.hostname,'access':{'required':True,'teamName':team,'audTag':[args.aud]}}},{'service':'http_status:404'}]}
    return credentials,cloudflared,config

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['hostname','team','aud','tunnel']:p.add_argument('--'+name,required=True)
    p.add_argument('--credentials');p.add_argument('--cloudflared');p.add_argument('--port',type=int,default=17860);p.add_argument('--write',action='store_true')
    args=p.parse_args();credentials,cloudflared,config=prepare(args)
    print(f'HTTPS origin: https://{args.hostname}; loopback port: {args.port}; Access JWT required; default route: 404')
    if not args.write:print('Plan only. Add --write to save configuration and user units.');return
    config_file=ROOT/'manga-studio/studio.config.json';studio=json.loads(config_file.read_text())
    backup=ROOT/'work/remote-access/studio.config.before-tunnel.json';backup.parent.mkdir(parents=True,exist_ok=True)
    if not backup.exists():backup.write_text(json.dumps(studio,indent=2)+'\n');backup.chmod(0o600)
    studio.update(remoteOrigin='https://'+args.hostname,remotePort=args.port);config_file.write_text(json.dumps(studio,ensure_ascii=False,indent=2)+'\n');config_file.chmod(0o600)
    secret=ROOT/'secrets/cloudflare';secret.mkdir(parents=True,exist_ok=True);secret.chmod(0o700)
    tunnel_config=secret/'config.json';tunnel_config.write_text(json.dumps(config,indent=2)+'\n');tunnel_config.chmod(0o600);credentials.chmod(0o600)
    # systemd quoting, including specifier escaping. These are argv, never a shell.
    def quote(value):return '"'+str(value).replace('%','%%').replace('\\','\\\\').replace('"','\\"')+'"'
    directory=Path.home()/'.config/systemd/user';directory.mkdir(parents=True,exist_ok=True)
    commands={
      'mang-ai-web':[ROOT/'manga-studio/node_modules/node/bin/node',ROOT/'manga-studio/scripts/launch.mjs','--no-open'],
      'mang-ai-tunnel':[cloudflared,'--no-autoupdate','tunnel','--config',tunnel_config,'run'],
    }
    for name,argv in commands.items():
        dependency='After=mang-ai-web.service\nWants=mang-ai-web.service\n' if name=='mang-ai-tunnel' else ''
        text=f'[Unit]\nDescription={name}\n{dependency}\n[Service]\nType=simple\nWorkingDirectory={quote(ROOT/"manga-studio")}\nExecStart={" ".join(quote(a) for a in argv)}\nRestart=on-failure\nRestartSec=5\nUMask=0077\n\n[Install]\nWantedBy=default.target\n'
        (directory/(name+'.service')).write_text(text)
    print('Saved private configuration and user services. Existing processes were not stopped.')
    print('Validate: cloudflared tunnel --config '+str(tunnel_config)+' ingress validate')
    print('After the current GUI is idle: systemctl --user daemon-reload; systemctl --user enable --now mang-ai-web.service mang-ai-tunnel.service')

if __name__=='__main__':main()
