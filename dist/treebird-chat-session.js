#!/usr/bin/env node
import{resolve as W,dirname as o}from"node:path";import{existsSync as l,mkdirSync as n,writeFileSync as s,appendFileSync as t}from"node:fs";import{networkInterfaces as i}from"node:os";import{fileURLToPath as r}from"node:url";import{spawnSync as N,spawn as a}from"node:child_process";import{chmodSync as E,existsSync as U,mkdirSync as k,readFileSync as f,renameSync as w,writeFileSync as g}from"node:fs";import{resolve as D,dirname as y,sep as Vz}from"node:path";import{homedir as V,networkInterfaces as Oz}from"node:os";var Y=D(V(),".treebird-chat","sessions.json"),I=["PATH","HOME","LANG","LC_ALL","TERM","TMPDIR"];function R(z={}){let J={};for(let Q of I)if(process.env[Q]!==void 0)J[Q]=process.env[Q];for(let[Q,Z]of Object.entries(z))if(Z!==void 0&&Z!==null)J[Q]=String(Z);return J}function S(){if(!U(Y))return{};try{return JSON.parse(f(Y,"utf8"))}catch{return{}}}function m(z){k(y(Y),{recursive:!0,mode:448});let J=`${Y}.tmp.${process.pid}`;g(J,JSON.stringify(z,null,2)+`
`,{mode:384}),w(J,Y),E(Y,384)}function O(z,J){let Q=S();Q[z]={...J,updated_at:new Date().toISOString()},m(Q)}var Mz=D(V(),".treebird-chat","rooms");var p=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;function h(z){return typeof z==="string"&&p.test(z)}function v(z){if(!h(z))throw Error(`Invalid agent name "${z}": must start with a letter and contain only letters, digits, hyphens, or underscores (max 64 chars).`);return z}function c(z){let J=String(z);if(J.endsWith("--"))return{agent:J.slice(0,-2),machine:null,instance:null};let Q=J.split("-"),Z=null,X=null;if(Q.length>=3&&/^\d+$/.test(Q[Q.length-1]))Z=parseInt(Q.pop(),10);if(Q.length>=2)X=Q.pop();return{agent:Q.join("-"),machine:X,instance:Z}}function d(z=null){let J=z||process.env.BIRDCHAT_AGENT||process.env.ENVOAK_AGENT_LABEL;if(!J)throw Error("No identity. Pass --as <agent>, set BIRDCHAT_AGENT, or set ENVOAK_AGENT_LABEL (via `envoak identity pull --export`).");let Q=c(J),Z=Q.agent,_=typeof J==="string"&&J.endsWith("--")?null:process.env.TREEBIRD_MACHINE||Q.machine,B=z?"cli":process.env.BIRDCHAT_AGENT?"env":"envoak";return v(Z),{agent:Z,machine:_,instance:Q.instance,label:J,source:B,verified:B==="envoak"}}function M(z=null){try{return d(z)}catch{return null}}var G=o(r(import.meta.url)),e=W(G,"treebird-chat-allow.mjs"),T=W(G,"treebird-chat.mjs"),zz=W(G,"gemma-bridge.mjs"),Jz=process.env.TREEBIRD_COLLAB_DIR?W(process.env.TREEBIRD_COLLAB_DIR):W(process.env.HOME,"collab"),x=`treebird-chat-session — create a session file, set owner + ACL, print join commands

usage: treebird-chat-session [--name <topic>] [--owner <agent>] [--dir <path>]
                             [--invite <agent>]... [--join]

  --name <topic>    session topic (default: today's date). File: CONSORTIUM_<name>_<date>.md
  --owner <agent>   room owner (default: your envoak identity, else 'treebird')
  --dir <path>      output dir (default: $TREEBIRD_COLLAB_DIR or ~/collab)
  --invite <agent>  allow an agent in the ACL (repeatable)
  --join            open the TUI immediately after creating
  --help, -h        show this help
`;function Qz(z){if(z.some((Q)=>Q==="--help"||Q==="-h"))process.stdout.write(x),process.exit(0);let J={name:null,invites:[],owner:null,dir:Jz,join:!1};for(let Q=0;Q<z.length;Q++){let Z=z[Q];if(Z==="--name")J.name=z[++Q];else if(Z==="--invite")J.invites.push(z[++Q]);else if(Z==="--owner")J.owner=z[++Q];else if(Z==="--dir")J.dir=W(z[++Q]);else if(Z==="--join")J.join=!0;else process.stderr.write(`unknown argument: ${Z}

${x}`),process.exit(2)}return J}function Zz(z){if(z)return{owner:z,verified:!1,explicit:!0};let J=M();if(J)return{owner:J.agent,verified:J.verified,explicit:!1};return{owner:"treebird",verified:!1,explicit:!1}}function P(){return new Date().toISOString().slice(0,10)}function $z(){let z=new Date;return`${String(z.getHours()).padStart(2,"0")}:${String(z.getMinutes()).padStart(2,"0")}`}function b(z,J,Q){if(N(process.execPath,[e,z,J,"--owner",Q],{stdio:"inherit"}).status!==0)process.stderr.write(`  ⚠️  allow failed for ${J}
`)}function Xz(z){let J=a(process.execPath,[zz,z],{stdio:["ignore","ignore","inherit"],detached:!0,env:R()});return J.on("error",(Q)=>process.stderr.write(`  ⚠️  gemma-bridge failed to start: ${Q.message}
`)),J.unref(),J.pid}function Wz(){let z=[];for(let Z of Object.values(i()))for(let X of Z||[])if(X.family==="IPv4"&&!X.internal&&!X.address.startsWith("169.254."))z.push(X.address);let J=(Z)=>Z.startsWith("192.168.")||Z.startsWith("10.")||/^172\.(1[6-9]|2\d|3[01])\./.test(Z),Q=[...z.filter(J),...z.filter((Z)=>!J(Z))];return Q.length?Q:["<this-host-ip>"]}function Kz(z){return String(z).replace(/[^\w.-]+/g,"_").replace(/^\.+/,"_")||"session"}var{name:Yz,invites:C,owner:qz,dir:A,join:Cz}=Qz(process.argv.slice(2)),{owner:K,verified:u,explicit:Hz}=Zz(qz),Gz=Yz||P(),j=`CONSORTIUM_${Kz(Gz)}_${P()}.md`,$=W(A,j),q=j.replace(/\.md$/,"");n(A,{recursive:!0});if(!l($))s($,`# ${j.replace(".md","")}

`,"utf8");O(q,{filePath:$});process.stdout.write(`
\uD83D\uDCC4 Session: ${$}
`);process.stdout.write(`   chat-id: ${q}  (registered → join with: trbc join ${q} --as <name>)
`);process.stdout.write(`   Owner: ${K}${u?" (envoak-verified)":" (unverified)"}

`);if(!u)process.stdout.write(Hz?`⚠️  Owner "${K}" was set explicitly and is not envoak-verified. Names are unverified and impersonable; the ACL is the only gate.

`:`⚠️  No envoak identity found — owner defaulted to "${K}" (unverified). Run \`envoak identity pull --export\` first for a verified owner.

`);b($,K,K);var F=!1;for(let z of C)if(b($,z,K),z==="gemma"&&!F){let J=Xz($);process.stdout.write(`\uD83E\uDD16 gemma-bridge started (PID ${J})
`),F=!0}var jz=C.length?C.join(", "):"none";t($,`[${$z()} ${K}] session open — invited: ${jz}
`);process.stdout.write(`
export CHAT=${$}
`);process.stdout.write(`
Join (this machine):  node ${T} $CHAT
`);if(C.includes("gemma"))process.stdout.write(`Gemma: already running. Say @gemma in chat to talk to it.
`);var H=Wz(),L=`http://${H[0]}:3000`;process.stdout.write(`
Join from ANOTHER machine (e.g. an agent on m2):
  1. here (host):    treebird-chat-bridge ${q} $CHAT --smalltoak-url ${L}
  2. there (remote): treebird-chat-join ${q} --smalltoak-url ${L} --as <agent>
`);if(H.length>1)process.stdout.write(`  # if the remote can't connect, try an alt host IP (same-subnet): ${H.slice(1).map((z)=>`http://${z}:3000`).join("  ")}
`);process.stdout.write(`
`);if(Cz){process.stdout.write(`Opening TUI...

`);let z=N(process.execPath,[T,$],{stdio:"inherit"});process.exit(z.status??0)}
