// Keyless, synthetic tone only. Large generated MP3 is a local verification artifact.
// Usage: node tests/fixtures/media/generate.mjs [seconds] [output.mp3]
import { createMp3Encoder } from "wasm-media-encoders";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
const seconds=Number(process.argv[2]??7200), path=process.argv[3]??"tests/fixtures/media/synthetic-two-hour.mp3";
if(!Number.isSafeInteger(seconds)||seconds<=0)throw new Error("Positive integer seconds required");
const encoder=await createMp3Encoder();encoder.configure({sampleRate:16000,outputSampleRate:16000,channels:1,bitrate:32});
const pcm=Float32Array.from({length:16000},(_,i)=>Math.sin(2*Math.PI*440*i/16000)*.4), file=createWriteStream(path);
for(let i=0;i<seconds;i++){
 const bytes=new Uint8Array(encoder.encode([pcm]));if(!file.write(bytes))await once(file,"drain");
 if(i%600===0)console.log(`Generated ${i}/${seconds} synthetic seconds`);
}
file.end(new Uint8Array(encoder.finalize()));await once(file,"finish");console.log(path);
