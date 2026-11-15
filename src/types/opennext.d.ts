// Keep clean-checkout typechecks independent of OpenNext's generated output.
declare module "*.open-next/worker.js" {
  const handler: { fetch: ExportedHandlerFetchHandler<CloudflareEnv> };
  export default handler;
}
