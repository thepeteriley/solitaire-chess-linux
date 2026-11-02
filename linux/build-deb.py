"""Build a Debian binary package with root-owned tar entries on any build host."""
import gzip, hashlib, io, os, pathlib, shutil, sys, tarfile, tempfile, time
root=pathlib.Path(__file__).resolve().parent.parent
bundle=pathlib.Path(sys.argv[1]); arch={'x64':'amd64','arm64':'arm64'}[sys.argv[2]]; version=sys.argv[3]+'-1'
out=root/'release/linux'/f'solitaire-chess_{version}_{arch}.deb'
with tempfile.TemporaryDirectory(prefix='solitaire-deb-') as tmp:
    stage=pathlib.Path(tmp)
    target=stage/'opt/solitaire-chess';target.parent.mkdir(parents=True);shutil.copytree(bundle,target,symlinks=True)
    def write(path,text,mode=0o644):
        p=stage/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text);p.chmod(mode)
    write('usr/bin/solitaire-chess','#!/bin/sh\nexec /opt/solitaire-chess/solitaire-chess "$@"\n',0o755)
    desktop=stage/'usr/share/applications';desktop.mkdir(parents=True)
    shutil.copyfile(root/'linux/com.peteriley.solitairechess.desktop',desktop/'com.peteriley.solitairechess.desktop')
    icon=stage/'usr/share/icons/hicolor/1024x1024/apps';icon.mkdir(parents=True)
    shutil.copyfile(root/'resources/icon.png',icon/'com.peteriley.solitairechess.png')
    write('usr/share/doc/solitaire-chess/copyright',(root/'linux/LICENSE').read_text()+'\nElectron/Chromium notices: /opt/solitaire-chess/LICENSE*\nOther third-party notices: /opt/solitaire-chess/resources/ThirdParty/\nStockfish is supplied by the distribution as a separate dependency. See /usr/share/doc/stockfish/copyright.\n')
    write('usr/share/doc/solitaire-chess/README','Solitaire Chess — installed desktop chess board with local Stockfish evaluation.\nRun solitaire-chess as your normal user, not with sudo. No account or internet connection is required after installation.\n')
    # Packager creates private staging directories; installed app files must be readable by users.
    for p in stage.rglob("*"):
        if p.is_symlink(): continue
        p.chmod(0o755 if p.is_dir() or p.stat().st_mode & 0o111 else 0o644)
    # Keep Chromium sandbox enabled, including on systems restricting user namespaces.
    (target/'chrome-sandbox').chmod(0o4755)
    paths=sorted(stage.rglob('*'))
    sums=''.join(hashlib.md5(p.read_bytes()).hexdigest()+'  '+str(p.relative_to(stage))+'\n' for p in paths if p.is_file() and not p.is_symlink())
    depends='stockfish, fonts-dejavu-core, libc6 (>= 2.31), libgcc-s1, libstdc++6, libasound2t64 (>= 1.2.2) | libasound2 (>= 1.2.2), libatk1.0-0 | libatk1.0-0t64, libatk-bridge2.0-0 | libatk-bridge2.0-0t64, libatspi2.0-0 | libatspi2.0-0t64, libcairo2, libcups2 | libcups2t64, libdbus-1-3, libdrm2, libexpat1, libgbm1, libglib2.0-0 | libglib2.0-0t64, libgtk-3-0 | libgtk-3-0t64, libnspr4, libnss3, libpango-1.0-0, libudev1, libx11-6, libxcb1, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxkbcommon0, libxrandr2'
    control=f'Package: solitaire-chess\nVersion: {version}\nArchitecture: {arch}\nMaintainer: Pete Riley <8104619+thepeteriley@users.noreply.github.com>\nSection: games\nPriority: optional\nInstalled-Size: {sum(p.stat().st_size for p in paths if p.is_file())//1024}\nDepends: {depends}\nHomepage: https://thepeteriley.github.io/solitaire-chess-support/\nDescription: Chess board with live local Stockfish evaluation\n Play against the computer or move both sides, preview candidate variations,\n adjust computer strength, and import FEN positions. Works offline.\n'
    def archive(entries):
        stream=io.BytesIO()
        with tarfile.open(fileobj=stream,mode='w',format=tarfile.GNU_FORMAT) as tar:
            for name,payload,mode in entries:
                info=tarfile.TarInfo(name);info.size=len(payload);info.mode=mode;info.uid=info.gid=0;info.uname=info.gname='root';tar.addfile(info,io.BytesIO(payload))
        return gzip.compress(stream.getvalue(),compresslevel=6,mtime=0)
    controls=archive([('./control',control.encode(),0o644),('./md5sums',sums.encode(),0o644)])
    data=io.BytesIO()
    with tarfile.open(fileobj=data,mode='w:gz',format=tarfile.GNU_FORMAT) as tar:
        def owned(info):
            info.uid=info.gid=0;info.uname=info.gname='root';return info
        for p in sorted(stage.iterdir()):tar.add(p,arcname='./'+p.name,filter=owned)
    partial=out.with_suffix('.deb.part')
    with partial.open('wb') as deb:
        deb.write(b'!<arch>\n')
        for name,payload in [('debian-binary',b'2.0\n'),('control.tar.gz',controls),('data.tar.gz',data.getvalue())]:
            header=f'{name+"/":<16}{0:<12}{0:<6}{0:<6}{"100644":<8}{len(payload):<10}`\n'.encode();assert len(header)==60
            deb.write(header);deb.write(payload)
            if len(payload)%2:deb.write(b'\n')
    os.replace(partial,out)
    print(out)
