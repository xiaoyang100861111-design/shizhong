/*
 * Server-mode boot data. This static file is the offline demo: when the app is opened from file:// or a
 * plain static host, SZ_SERVER stays null and everything runs locally as in v2. When the ASP.NET Core
 * backend hosts the site it answers /core/server.js itself with the public settings, the signed-in
 * account and its state (see server/Shizhong.Api/Modules/Platform/PlatformModule.cs).
 */
window.SZ_SERVER = null;
