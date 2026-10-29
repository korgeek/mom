import {expect,it} from 'vitest';
import {validatePassphrase} from '../src/react-app/vault/crypto';
import {validateNewPassphrase} from '../src/react-app/vault/passphrase-policy';
it('requires longer new passphrases without changing legacy unlock compatibility',()=>{
 expect(()=>validatePassphrase('legacy-8')).not.toThrow();expect(()=>validateNewPassphrase('legacy-8')).toThrow();
 for(const value of [' '.repeat(15),'a'.repeat(15),'abcd'.repeat(4),'passwordpassword','password123456789','123456789012345','a long phrase\nwith controls'])expect(()=>validateNewPassphrase(value)).toThrow();
 for(const value of ['SYNTHETIC unique passphrase 29!',' 바다 너머 서로 다른 나무와 구름 ', '🦊abcdefghijklmno'])expect(()=>validateNewPassphrase(value)).not.toThrow();
 expect(()=>validateNewPassphrase('A'.repeat(257))).toThrow();
});
