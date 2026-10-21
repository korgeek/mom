import { expect, it } from 'vitest';
import { bodyProviderError } from '../src/react-app/domain/pipeline';

it('classifies structured OpenRouter data-policy rejection without exposing upstream text', () => {
 const error=bodyProviderError({code:404,message:'PRIVATE_UPSTREAM_TEXT',metadata:{failed_routing_step:'Filter by Data Policy'}},404,0);
 expect(error).toMatchObject({code:'data-policy',status:404,outcomeUnknown:false});
 expect(error.message).not.toContain('PRIVATE_UPSTREAM_TEXT');
});
it('keeps ordinary missing endpoints and authentication errors distinct from data policy', () => {
 expect(bodyProviderError({code:404},404,0).code).toBe('malformed');
 expect(bodyProviderError({code:401,metadata:{failed_routing_step:'Filter by Data Policy'}},401,0).code).toBe('authentication');
});
