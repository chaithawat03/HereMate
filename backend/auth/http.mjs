/**
 * Pure HTTP boundary for M0.5.3 Phone+Password -> Firebase Custom Token.
 * The future Cloud Run adapter MUST supply an authenticated trusted sourceTag
 * and enforce the HTTP request stream body limit before calling this function.
 */
import { AuthNotReady, AuthRateLimited, AuthRejected } from './phone-login.mjs';

const headers=Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'"
});
const reply=(status,body)=>Object.freeze({ status,headers,body });

export async function handlePhoneLoginHttp({ method, path, contentType, bodyText, sourceTag }, authService) {
  if (path!=='/v1/auth/phone/login') return reply(404,{error:'not_found'});
  if (method!=='POST') return reply(405,{error:'method_not_allowed'});
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(contentType||'')) return reply(415,{error:'unsupported_media_type'});
  if (typeof bodyText!=='string' || Buffer.byteLength(bodyText,'utf8')>2048)
    return reply(413,{error:'payload_too_large'});
  let body;
  try {body=JSON.parse(bodyText);}
  catch {return reply(400,{error:'invalid_request'});}
  if (!body || typeof body!=='object' || Array.isArray(body) ||
      Object.keys(body).some(k=>!['phone','password'].includes(k)) ||
      typeof body.phone!=='string' || typeof body.password!=='string')
    return reply(400,{error:'invalid_request'});

  try {
    // sourceTag is NEVER read from the JSON request body.
    const {customToken}=await authService.login({phone:body.phone,password:body.password,sourceTag});
    return reply(200,{customToken});
  } catch(e) {
    if (e instanceof AuthRateLimited) return reply(429,{error:'too_many_attempts'});
    if (e instanceof AuthRejected) return reply(401,{error:'invalid_credentials'});
    // Unexpected failures intentionally have no error detail exposed to client.
    // Logging handler must log redacted structured error class only.
    return reply(503,{error:'temporarily_unavailable'});
  }
}
