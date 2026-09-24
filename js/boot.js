// Independent of Firebase and app imports: also works when their download fails.
(() => {
    let ready=false;
    const timer=setTimeout(()=>{
        if(ready)return;
        const box=document.createElement('section');box.id='boot-recovery';box.setAttribute('role','alert');
        box.style.cssText='position:fixed;inset:20px 16px auto;max-width:540px;margin:auto;z-index:100000;padding:24px;background:#fff;color:#243a32;border:1px solid #dbe5e0;border-radius:16px;box-shadow:0 10px 40px #0002;font:16px/1.7 system-ui,sans-serif';
        box.innerHTML='<h2 style="margin:0;font-size:20px">연결이 지연되고 있어요</h2><p>화면에 필요한 파일이나 데이터를 아직 받지 못했습니다. 와이파이·모바일 데이터를 바꾸거나, 카카오톡 메뉴에서 다른 브라우저로 열어 주세요.</p><p style="font-size:13px">Loading is taking longer than usual. Check your connection or open this link in your browser.</p><button type="button" style="padding:12px 18px;background:#17664d;color:#fff;border:0;border-radius:8px;font:inherit">다시 불러오기 · Retry</button>';
        box.querySelector('button').onclick=()=>{
            if(window.hasUnsavedMeeting?.()){alert('미저장 경기 편집이 있습니다. 먼저 저장 상태를 확인해 주세요.');return;}
            location.reload();
        };
        document.body?.append(box);
    },12000);
    window.bareaBootReady=()=>{ready=true;clearTimeout(timer);document.getElementById('boot-recovery')?.remove();};
})();
