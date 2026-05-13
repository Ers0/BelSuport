// src/components/PhoneLogin.jsx
import { useState, useRef, useEffect } from 'react';

const S = {
  wrap:     { display:'flex', flexDirection:'column', gap:16, width:'100%', maxWidth:380, margin:'0 auto' },
  field:    { display:'flex', flexDirection:'column', gap:4 },
  label:    { fontSize:12, color:'var(--tm)', fontWeight:600, letterSpacing:'.03em' },
  input:    { background:'var(--s2)', border:'1px solid var(--b2)', color:'var(--tx)', borderRadius:'var(--rs)', padding:'12px 14px', fontSize:16, fontFamily:'inherit', outline:'none', width:'100%', boxSizing:'border-box' },
  btn:      { width:'100%', padding:'14px', background:'var(--y)', color:'#000', border:'none', borderRadius:'var(--rs)', fontWeight:800, fontSize:15, cursor:'pointer', fontFamily:'inherit' },
  btnGhost: { width:'100%', padding:'12px', background:'transparent', color:'var(--ts)', border:'1px solid var(--b2)', borderRadius:'var(--rs)', fontWeight:600, fontSize:13, cursor:'pointer', fontFamily:'inherit' },
  error:    { padding:'10px 12px', background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.3)', borderRadius:'var(--rs)', color:'var(--re)', fontSize:13, lineHeight:1.5 },
  info:     { padding:'10px 12px', background:'rgba(251,146,60,.1)', border:'1px solid rgba(251,146,60,.3)', borderRadius:'var(--rs)', color:'var(--or)', fontSize:13, lineHeight:1.5 },
  title:    { fontSize:20, fontWeight:800, color:'var(--tx)', marginBottom:2 },
  sub:      { fontSize:13, color:'var(--tm)', lineHeight:1.6 },
  hint:     { fontSize:11, color:'var(--tm)', lineHeight:1.5 },
};

function Field({ label, hint, children }) {
  return (
    <div style={S.field}>
      <label style={S.label}>{label}</label>
      {children}
      {hint && <span style={S.hint}>{hint}</span>}
    </div>
  );
}

function Inp({ type = 'text', style: stl, ...props }) {
  const [f, setF] = useState(false);
  return <input type={type} {...props} style={{ ...S.input, ...(f ? {borderColor:'var(--y)'} : {}), ...stl }} onFocus={() => setF(true)} onBlur={() => setF(false)} />;
}

function PwInput({ value, onChange, placeholder, onKeyDown }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position:'relative' }}>
      <Inp type={show ? 'text' : 'password'} value={value} onChange={onChange} placeholder={placeholder} onKeyDown={onKeyDown} style={{ paddingRight:44 }} />
      <button type="button" onClick={() => setShow(v=>!v)} style={{ position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',fontSize:16,color:'var(--tm)',lineHeight:1 }}>
        {show ? '🙈' : '👁️'}
      </button>
    </div>
  );
}

function PwStrength({ pw }) {
  if (!pw) return null;
  const checks = [pw.length >= 8, /[0-9]/.test(pw), /[a-zA-Z]/.test(pw)];
  const score = checks.filter(Boolean).length;
  const color = score < 2 ? 'var(--re)' : score < 3 ? 'var(--or)' : 'var(--gr)';
  return (
    <div>
      <div style={{ display:'flex', gap:3, margin:'4px 0 2px' }}>
        {[0,1,2].map(i => <div key={i} style={{ flex:1, height:3, borderRadius:2, background: i < score ? color : 'var(--b2)', transition:'background .2s' }} />)}
      </div>
      <span style={{ fontSize:10, color, fontWeight:700 }}>
        {score < 2 ? 'Fraca' : score < 3 ? 'Média' : 'Forte'}
        {score < 3 ? ' · mínimo 8 chars, letra e número' : ' ✓'}
      </span>
    </div>
  );
}

function OtpBoxes({ otp, setOtp, onDone }) {
  const refs = useRef([]);
  function set(i, val) {
    const d = val.replace(/\D/g,'').slice(-1);
    const n = [...otp]; n[i] = d; setOtp(n);
    if (d && i < 5) refs.current[i+1]?.focus();
    if (n.join('').length === 6) onDone?.(n.join(''));
  }
  return (
    <div style={{ display:'flex', gap:8, justifyContent:'center' }}
      onPaste={e => {
        const p = e.clipboardData.getData('text').replace(/\D/g,'').slice(0,6);
        if (p.length === 6) { setOtp(p.split('')); refs.current[5]?.focus(); onDone?.(p); }
      }}>
      {otp.map((d,i) => (
        <input key={i} ref={el => refs.current[i]=el} value={d} maxLength={1} inputMode="numeric"
          onChange={e => set(i, e.target.value)}
          onKeyDown={e => { if (e.key==='Backspace' && !d && i>0) refs.current[i-1]?.focus(); }}
          style={{ width:52, height:60, textAlign:'center', fontSize:26, fontWeight:800,
            background:'var(--s2)', border:`2px solid ${d?'var(--y)':'var(--b2)'}`,
            borderRadius:12, color:'var(--tx)', fontFamily:'inherit', outline:'none' }} />
      ))}
    </div>
  );
}

export default function PhoneLogin({ onSuccess, onBack }) {
  const [step,    setStep]   = useState('mode'); // mode|login|register|otp|pending|change_pw
  const [loading, setLoad]   = useState(false);
  const [error,   setError]  = useState('');
  const [info,    setInfo]   = useState('');
  const [masked,  setMasked] = useState('');
  const [cd,      setCd]     = useState(0);
  const timer = useRef(null);

  const [phone, setPhone]     = useState('');
  const [pw,    setPw]        = useState('');
  const [rName, setRName]     = useState('');
  const [rEmail,setREmail]    = useState('');
  const [rPhone,setRPhone]    = useState('');
  const [rPw,   setRPw]       = useState('');
  const [rPwC,  setRPwC]      = useState('');
  const [otp,   setOtp]       = useState(['','','','','','']);
  const [curPw, setCurPw]     = useState('');
  const [newPw, setNewPw]     = useState('');
  const [newPwC,setNewPwC]    = useState('');
  const [tUser, setTUser]     = useState(null);

  useEffect(() => {
    if (cd > 0) { timer.current = setTimeout(() => setCd(c=>c-1), 1000); }
    return () => clearTimeout(timer.current);
  }, [cd]);

  function fmtPhone(raw) {
    const d = raw.replace(/\D/g,'').slice(0,11);
    if (d.length <= 2) return d;
    if (d.length <= 7) return `(${d.slice(0,2)}) ${d.slice(2)}`;
    return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  }

  async function apiPost(path, body) {
    const r = await fetch(path, {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body),
    });
    const d = await r.json();
    return { ...d, ok: r.ok };
  }

  async function doLogin() {
    if (!phone || !pw) { setError('Preencha telefone/email e senha'); return; }
    setLoad(true); setError('');
    const d = await apiPost('/api/phone-auth/login', { phone, password: pw }).catch(e => ({ error: e.message }));
    setLoad(false);
    if (!d.ok) { setError(d.error); return; }
    if (d.token) localStorage.setItem('session_token', d.token);
    if (d.tempPassword) { setTUser(d.user); setCurPw(pw); setInfo('Senha temporária — crie uma nova senha para continuar.'); setStep('change_pw'); }
    else onSuccess?.(d.user);
  }

  async function doRegister() {
    if (!rName || !rPhone || !rPw || !rEmail) { setError('Preencha todos os campos obrigatórios'); return; }
    if (rPw !== rPwC) { setError('As senhas não coincidem'); return; }
    if (rPw.length < 8) { setError('Senha deve ter pelo menos 8 caracteres'); return; }
    if (!/[0-9]/.test(rPw) || !/[a-zA-Z]/.test(rPw)) { setError('Senha precisa ter letras e números'); return; }
    setLoad(true); setError('');
    const d = await apiPost('/api/phone-auth/register', { name:rName, email:rEmail, phone:rPhone, password:rPw }).catch(e => ({ error: e.message }));
    setLoad(false);
    if (!d.ok && !d.pending) { setError(d.error); return; }
    setStep('pending'); // go straight to pending — no OTP step
  }

  async function doVerifyOtp(code) {
    const c = code || otp.join('');
    if (c.length < 6) { setError('Digite os 6 dígitos'); return; }
    setLoad(true); setError('');
    const d = await apiPost('/api/phone-auth/verify-otp', { phone: rPhone, otp: c }).catch(e => ({ error: e.message }));
    setLoad(false);
    if (!d.ok) { setError(d.error); return; }
    setStep('pending');
  }

  async function doChangePw() {
    if (!newPw || newPw !== newPwC) { setError('As senhas não coincidem'); return; }
    if (newPw.length < 8 || !/[0-9]/.test(newPw) || !/[a-zA-Z]/.test(newPw)) { setError('Senha fraca'); return; }
    setLoad(true); setError('');
    const token = localStorage.getItem('session_token');
    const r = await fetch('/api/phone-auth/change-password', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json', ...(token?{'Authorization':'Bearer '+token}:{})},
      body: JSON.stringify({ currentPassword: curPw, newPassword: newPw }),
    });
    const d = await r.json();
    setLoad(false);
    if (!r.ok) { setError(d.error); return; }
    onSuccess?.(tUser);
  }

  function go(s) { setError(''); setInfo(''); setStep(s); }
  const CD = `${Math.floor(cd/60)}:${String(cd%60).padStart(2,'0')}`;

  // ── MODE ─────────────────────────────────────────────────────────────────────
  if (step === 'mode') return (
    <div style={S.wrap}>
      <div>
        <div style={S.title}>📱 Acesso por Telefone</div>
        <div style={S.sub}>Entre ou cadastre-se com seu WhatsApp.</div>
      </div>
      <button style={S.btn}       onClick={() => go('login')}>    Entrar com telefone + senha</button>
      <div style={{ display:'flex', alignItems:'center', gap:10, color:'var(--tm)', fontSize:12 }}>
        <div style={{ flex:1, height:1, background:'var(--b1)' }} /> novo usuário <div style={{ flex:1, height:1, background:'var(--b1)' }} />
      </div>
      <button style={S.btnGhost}  onClick={() => go('register')}>  Criar conta</button>
      <button style={S.btnGhost}  onClick={onBack}>                ← Entrar com Google</button>
    </div>
  );

  // ── LOGIN ────────────────────────────────────────────────────────────────────
  if (step === 'login') return (
    <div style={S.wrap}>
      <div><div style={S.title}>🔑 Login</div><div style={S.sub}>Telefone ou email + senha.</div></div>
      {error && <div style={S.error}>{error}</div>}
      <Field label="Telefone ou Email">
        <Inp placeholder="(19) 99999-9999 ou email" value={phone} autoFocus onChange={e=>setPhone(e.target.value)} onKeyDown={e=>e.key==='Enter'&&doLogin()} />
      </Field>
      <Field label="Senha">
        <PwInput value={pw} onChange={e=>setPw(e.target.value)} placeholder="Sua senha" onKeyDown={e=>e.key==='Enter'&&doLogin()} />
      </Field>
      <button style={{ ...S.btn, opacity:loading?.7:1 }} onClick={doLogin} disabled={loading}>{loading?'⟳ Entrando...':'Entrar'}</button>
      <button style={S.btnGhost} onClick={() => go('mode')}>← Voltar</button>
    </div>
  );

  // ── REGISTER ─────────────────────────────────────────────────────────────────
  if (step === 'register') return (
    <div style={S.wrap}>
      <div><div style={S.title}>✏️ Criar conta</div><div style={S.sub}>Um administrador aprovará seu acesso após o cadastro.</div></div>
      {error && <div style={S.error}>{error}</div>}
      <Field label="Nome completo *">
        <Inp placeholder="Seu nome" value={rName} autoFocus onChange={e=>setRName(e.target.value)} />
      </Field>
      <Field label="Email *" hint="O código de verificação de 6 dígitos será enviado aqui">
        <Inp type="email" placeholder="seu@email.com" value={rEmail} onChange={e=>setREmail(e.target.value)} />
      </Field>
      <Field label="WhatsApp (com DDD)" hint="Código de verificação será enviado aqui">
        <Inp type="tel" placeholder="(19) 99999-9999" value={fmtPhone(rPhone)} onChange={e=>setRPhone(e.target.value.replace(/\D/g,''))} style={{ letterSpacing:1 }} />
      </Field>
      <Field label="Senha *" hint="Mínimo 8 caracteres com letra e número">
        <PwInput value={rPw} onChange={e=>setRPw(e.target.value)} placeholder="Crie uma senha" />
        <PwStrength pw={rPw} />
      </Field>
      <Field label="Confirmar senha *">
        <Inp type="password" placeholder="Repita a senha" value={rPwC}
          onChange={e=>setRPwC(e.target.value)} onKeyDown={e=>e.key==='Enter'&&doRegister()}
          style={{ borderColor: rPwC && rPw!==rPwC ? 'var(--re)' : undefined }} />
        {rPwC && rPw!==rPwC && <span style={{ fontSize:11, color:'var(--re)' }}>Senhas não coincidem</span>}
      </Field>
      <button style={{ ...S.btn, opacity:loading?.7:1 }} onClick={doRegister} disabled={loading}>
        {loading ? '⟳ Enviando...' : '📧 Enviar código de verificação'}
      </button>
      <button style={S.btnGhost} onClick={() => go('mode')}>← Voltar</button>
    </div>
  );

  // ── OTP ───────────────────────────────────────────────────────────────────────
  if (step === 'otp') return (
    <div style={S.wrap}>
      <div>
        <div style={S.title}>🔐 Verificar WhatsApp</div>
        <div style={S.sub}>Código enviado para seu email.{cd>0&&<><br/><span style={{ color:'var(--y)',fontWeight:700 }}>Expira em {CD}</span></>}</div>
      </div>
      {error && <div style={S.error}>{error}</div>}
      <OtpBoxes otp={otp} setOtp={setOtp} onDone={doVerifyOtp} />
      <button style={{ ...S.btn, opacity:loading?.7:1 }} onClick={() => doVerifyOtp()} disabled={loading||otp.join('').length<6}>
        {loading ? '⟳ Verificando...' : '✓ Confirmar código'}
      </button>
      {cd===0 && <button style={S.btnGhost} onClick={() => { setOtp(['','','','','','']); go('register'); }}>↺ Reenviar código</button>}
      <button style={S.btnGhost} onClick={() => go('register')}>← Voltar</button>
    </div>
  );

  // ── PENDING ───────────────────────────────────────────────────────────────────
  if (step === 'pending') return (
    <div style={S.wrap}>
      <div style={{ textAlign:'center', padding:'8px 0' }}>
        <div style={{ fontSize:52, marginBottom:12 }}>⏳</div>
        <div style={S.title}>Aguardando aprovação</div>
        <div style={{ ...S.sub, marginTop:8 }}>
          Email verificado!{rName&&` Olá ${rName.split(' ')[0]}!`}<br/><br/>
          Um administrador irá aprovar seu acesso. Você receberá um email quando for aprovado.
        </div>
      </div>
      <button style={S.btnGhost} onClick={onBack}>← Voltar ao login</button>
    </div>
  );

  // ── CHANGE PASSWORD ───────────────────────────────────────────────────────────
  if (step === 'change_pw') return (
    <div style={S.wrap}>
      <div><div style={S.title}>🔒 Nova senha obrigatória</div></div>
      {info  && <div style={S.info}>{info}</div>}
      {error && <div style={S.error}>{error}</div>}
      <Field label="Senha temporária (atual)">
        <PwInput value={curPw} onChange={e=>setCurPw(e.target.value)} placeholder="Senha temporária do administrador" />
      </Field>
      <Field label="Nova senha *" hint="Mínimo 8 caracteres com letra e número">
        <PwInput value={newPw} onChange={e=>setNewPw(e.target.value)} placeholder="Sua nova senha" />
        <PwStrength pw={newPw} />
      </Field>
      <Field label="Confirmar nova senha *">
        <Inp type="password" value={newPwC} onChange={e=>setNewPwC(e.target.value)}
          placeholder="Repita a nova senha" onKeyDown={e=>e.key==='Enter'&&doChangePw()}
          style={{ borderColor: newPwC&&newPw!==newPwC?'var(--re)':undefined }} />
      </Field>
      <button style={{ ...S.btn, opacity:loading?.7:1 }} onClick={doChangePw} disabled={loading}>
        {loading ? '⟳ Salvando...' : '✓ Salvar nova senha e entrar'}
      </button>
    </div>
  );

  return null;
}
