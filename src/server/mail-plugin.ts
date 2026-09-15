import { definePlugin } from "nitro";
import { startMailRuntime, stopMailRuntime } from "../lib/mail/runtime.server";

export default definePlugin((app) => {
	startMailRuntime();
	app.hooks.hook("close", stopMailRuntime);
});
