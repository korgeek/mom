import { asObject, ProviderError } from '../domain/pipeline';
export function requestRecord(request:{url:string;body:FormData|string}, secret:string|null):unknown {

 let body:Record<string,unknown>={};
 if (request.body instanceof FormData) {
  for (const [key,value] of request.body.entries()) {
   const item=typeof value==='string'?value:{omitted:'audio bytes',bytes:value.size,type:value.type};
   if (body[key]===undefined) body[key]=item; else body[key]=Array.isArray(body[key])?[...(body[key] as unknown[]),item]:[body[key],item];
  }
 } else {
  const source=request.body, audioStart=source.indexOf('"input_audio":{'), dataStart=audioStart<0?-1:source.indexOf('"data":"',audioStart);
  if (dataStart>=0) {
   const begin=dataStart+8, end=source.indexOf('"',begin);
   if(end<0)throw new Error('Invalid audio request');
   const length=end-begin, padding=source[end-1]==='='?(source[end-2]==='='?2:1):0;
   body=JSON.parse(source.slice(0,begin)+'[omitted]'+source.slice(end)) as Record<string,unknown>;
   const audio=asObject(body.input_audio);
   if(audio) body.input_audio={...audio,data:{omitted:'audio base64',bytes:Math.floor(length*3/4)-padding}};
  } else body=JSON.parse(source) as Record<string,unknown>;
 }
 return {method:'POST',url:redactRecordedValue(request.url,secret),body:redactRecordedValue(body,secret)};
}
export function redactRecordedValue(value:unknown, secret:string|null):unknown {
 if(typeof value==='string')return (secret?value.split(secret).join('[redacted]'):value).replace(/\bsk-[a-zA-Z0-9_-]+|Bearer\s+\S+/gu,'[redacted]');
 if(Array.isArray(value))return value.map(item=>redactRecordedValue(item,secret));
 const object=asObject(value);return object?Object.fromEntries(Object.entries(object).map(([key,item])=>[String(redactRecordedValue(key,secret)),/^(?:authorization|proxy-authorization|headers|api[_-]?key|secret|password|credentials?)$/iu.test(key)?'[redacted]':redactRecordedValue(item,secret)])):value;
}
export function recordedFailure(error:unknown,request:unknown,secret:string|null):unknown {
 if(!(error instanceof ProviderError) || request===undefined)return error;
 return new ProviderError(error.code,{status:error.status??undefined,httpStatus:error.httpStatus,retryAt:error.retryAt,outcomeUnknown:error.outcomeUnknown,sensitiveResponse:redactRecordedValue(error.readSensitiveResponse(),secret),sensitiveRequest:request});
}
