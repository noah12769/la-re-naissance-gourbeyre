/* Public Supabase project config for La Re-Naissance's admin (connexion.html / admin.html).
 *
 * Safe to expose client-side: this is the "publishable"/"anon" key, paired with the Row
 * Level Security policies and Storage policies in ../../../supabase/schema.sql. Those
 * policies -- not this key -- are what actually restrict writes to a signed-in admin;
 * this key alone grants no more than anonymous/public read access.
 *
 * Never put the "service_role" / "Secret key" here or anywhere else in this repo: that one
 * bypasses every RLS policy and must stay inside the Supabase dashboard only.
 */
window.SUPABASE_URL = 'https://jnjyekeakikguumdjccf.supabase.co';
window.SUPABASE_ANON_KEY = 'sb_publishable_mhGPDZUGxzzhQmQY3sXrMQ_WyjHnNQX';
