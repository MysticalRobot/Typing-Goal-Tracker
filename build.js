try {
  const outdir = './dist';
  await Bun.build({ entrypoints: ['./src/background-script.ts'], outdir, format: 'esm' })
  await Bun.build({ entrypoints: ['./src/content-script.ts'], outdir, format: 'iife'})
  await Bun.build({ entrypoints: ['./src/popup/index.html'], outdir })
} catch (error) {
  console.error(error);
}
