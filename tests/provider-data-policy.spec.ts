import { expect, it } from 'vitest';
import { bodyProviderError } from '../src/react-app/domain/pipeline';

it('retains the actual HTTP status when an upstream error code supplies a different status', () => {
 const error = bodyProviderError({code:400,message:'Synthetic upstream failure'},200,0);
 expect(error.code).toBe('invalid-input');
 expect(error.httpStatus).toBe(200);
});

it('classifies structured OpenRouter data-policy rejection without exposing upstream text', () => {
 const error=bodyProviderError({code:404,message:'PRIVATE_UPSTREAM_TEXT',metadata:{failed_routing_step:'Filter by Data Policy'}},404,0);
 expect(error).toMatchObject({code:'data-policy',status:404,outcomeUnknown:false});
 expect(error.message).not.toContain('PRIVATE_UPSTREAM_TEXT');
});
it('keeps ordinary missing endpoints and authentication errors distinct from data policy', () => {
 expect(bodyProviderError({code:404},404,0).code).toBe('malformed');
 expect(bodyProviderError({code:401,metadata:{failed_routing_step:'Filter by Data Policy'}},401,0).code).toBe('authentication');
});
