const { createHmac, randomUUID } = require('node:crypto');

const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
const validName=n=>typeof n==='string'&&n===n.normalize('NFC').trim()&&n.length>0&&n.length<=100&&!/[\/\u0000-\u001f]/.test(n)&&!['.','..','__proto__','constructor','prototype'].includes(n);
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const validPicks=(p,name,roster)=>Array.isArray(p)&&p.length===3&&new Set(p).size===3&&p.every(n=>validName(n)&&n!==name&&roster.includes(n));
const failure=(code,status)=>Object.assign(new Error(code),{code,status});
function topThree(votes,roster) {
    const scores=new Map();
    for(const [voter,ballot] of Object.entries(votes||{})) {
        if(!roster.includes(voter)||!validPicks(ballot?.picks,voter,roster))continue;
        ballot.picks.forEach((name,i)=>scores.set(name,(scores.get(name)||0)+3-i));
    }
    // Exact maximum of three names; deterministic alphabetical tie-break, no scores published.
    return [...scores].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ko')).slice(0,3).map(([name])=>name);
}
function version(secret,date,name,ballot,receipt) {
    // An HMAC prevents a public status token from exposing low-entropy ballot choices.
    return createHmac('sha256',secret).update(JSON.stringify([date,name,ballot??null,receipt?.revision??null])).digest('base64url');
}
function productionServices(env,req) {
    // Vercel supplies a short-lived token to each Function request. Never persist
    // it in a file, response, log, or process-wide Firebase client.
    const token=req.headers['x-vercel-oidc-token'];
    const {GCP_PROJECT_ID:projectId,GCP_PROJECT_NUMBER:projectNumber,GCP_SERVICE_ACCOUNT_EMAIL:account,GCP_WORKLOAD_IDENTITY_POOL_ID:pool,GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID:provider}=env;
    const invalid=[];
    if(typeof token!=='string'||!token)invalid.push('oidc-token');
    if(!projectId||!/^\d+$/.test(projectNumber||'')||!account||!pool||!provider)invalid.push('connection-config');
    if(!env.BAREA_RATING_VERSION_SECRET||env.BAREA_RATING_VERSION_SECRET.length<32)invalid.push('version-secret-length');
    if(invalid.length)throw Object.assign(failure('unavailable',503),{diagnostic:invalid.join(',')});
    const {ExternalAccountClient,GoogleAuth}=require('google-auth-library');
    const {Firestore,FieldValue}=require('@google-cloud/firestore');
    const client=ExternalAccountClient.fromJSON({
        type:'external_account',
        audience:`//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${pool}/providers/${provider}`,
        subject_token_type:'urn:ietf:params:oauth:token-type:jwt',
        token_url:'https://sts.googleapis.com/v1/token',
        service_account_impersonation_url:`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${account}:generateAccessToken`,
        subject_token_supplier:{getSubjectToken:async()=>token}
    });
    if(!client)throw failure('unavailable',503);
    // Firestore forwards its auth option to google-gax. REST avoids a gRPC
    // channel surviving beyond this request's OIDC token lifetime.
    const db=new Firestore({projectId,auth:new GoogleAuth({projectId,authClient:client}),preferRest:true});
    return {db,timestamp:()=>FieldValue.serverTimestamp(),secret:env.BAREA_RATING_VERSION_SECRET,close:()=>db.terminate()};
}
function createHandler({env=process.env,services=req=>productionServices(env,req),now=()=>Date.now(),nonce=randomUUID}={}) {
    return async function handler(req,res) {
        res.setHeader('Cache-Control','no-store, max-age=0');
        res.setHeader('X-Content-Type-Options','nosniff');
        const send=(status,data)=>res.status(status).json(data);
        if(req.method!=='POST'){res.setHeader('Allow','POST');return send(405,{error:'method'});}
        if(!['true','read-only'].includes(env.BAREA_RATINGS_ENABLED)) {
            console.warn('ratings-connection','disabled-mode');
            return send(503,{error:'unavailable'});
        }
        let activeServices;
        try {
            // This is an intentional anonymous endpoint, NOT proof of a player's identity.
            const origin=new URL(env.BAREA_PUBLIC_ORIGIN||'https://bareaplay.vercel.app').origin;
            if(req.headers.origin!==origin||!String(req.headers['content-type']||'').startsWith('application/json'))throw failure('request',403);
            const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
            if(!body||JSON.stringify(body).length>4096||!['status','submit','leaders'].includes(body.action)||!validDate(body.date)||(body.action!=='leaders'&&!validName(body.name)))throw failure('request',400);
            const {action,date,name}=body;
            // Bootstrap connectivity without enabling production ballot writes.
            if(env.BAREA_RATINGS_ENABLED==='read-only'&&action==='submit')throw failure('unavailable',503);
            const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now()));
            if(date>=today)throw failure('request',400);
            if(action==='submit'&&(typeof body.expectedVersion!=='string'||body.expectedVersion.length>100))throw failure('request',400);
            activeServices=await services(req);
            const {db,timestamp,secret}=activeServices;
            const meetingRef=db.doc(`dailyMeetings/${date}`),ratingRef=db.doc(`ratings/${date}`),receiptRef=action==='leaders'?null:db.doc(`ratingParticipation/${date}/voters/${name}`),resultRef=db.doc(`ratingResults/${date}`);
            const result=await db.runTransaction(async tx=>{
                const [meeting,ratings,receipt]=await tx.getAll(...[meetingRef,ratingRef,receiptRef].filter(Boolean));
                const roster=[...new Set(Object.values(meeting.data()?.teams||{}).flat().map(p=>p?.name).filter(validName))];
                if(!meeting.exists)throw failure('request',400);
                const votes=ratings.data()?.votes||{},ballot=own(votes,name)?votes[name]:null;
                if(action==='leaders')return {leaders:topThree(votes,roster)};
                if(!roster.includes(name))throw failure('request',400);
                const currentVersion=version(secret,date,name,ballot,receipt.data());
                if(action==='status')return {exists:own(votes,name),version:currentVersion};
                if(!validPicks(body.picks,name,roster))throw failure('request',400);
                if(body.expectedVersion!==currentVersion)throw failure('changed',409);
                const replacement={picks:[...body.picks],at:now()};
                const leaders=topThree({...votes,[name]:replacement},roster);
                // All three writes commit together. Other ballots and unknown legacy fields survive.
                tx.set(ratingRef,{date,votes:{[name]:replacement}},{merge:true});
                tx.set(receiptRef,{submitted:true,revision:nonce(),updatedAt:timestamp()},{merge:true});
                tx.set(resultRef,{date,leaders,updatedAt:timestamp()});
                return {saved:true};
            });
            return send(200,result);
        } catch(error) {
            // Do not echo SDK errors, request contents, credentials or ballot data.
            const known=['request','changed','unavailable'].includes(error.code);
            if(!known||error.diagnostic) {
                // Allow-listed categories only. Never log SDK messages, response bodies,
                // request names, token values or environment-variable contents.
                const categories=['invalid_grant','invalid_target','unauthorized_client','invalid_request'];
                const oauthCode=error.response?.data?.error;
                console.warn('ratings-connection',error.diagnostic||
                    (categories.includes(oauthCode)?oauthCode:Number.isInteger(error.code)?`rpc-${error.code}`:'sdk-error'));
            }
            return send(known?error.status:503,{error:known?error.code:'unavailable'});
        } finally {
            // Best-effort cleanup; never turn a completed vote into an error.
            try { await activeServices?.close?.(); } catch (_) { /* do not log credentials */ }
        }
    };
}
module.exports={createHandler,topThree,version,productionServices};
