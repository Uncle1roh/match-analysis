/* Where the cloud copy lives.

   Leave both blank and nothing changes: the tagger and the finder stay the
   pure local tools they started as — video from disk, PDF from this folder,
   work saved as JSON downloads. Fill them in and you additionally get an
   email login, matches saved to Postgres, and the training pages served one
   page at a time from Storage.

   The anon key is meant to be public. It grants nothing on its own: every
   table is behind row-level security, and the session bucket is private. */
const SUPABASE = {
  url:     "https://wzpswtrudjmneidfbnru.supabase.co",
  anonKey: "sb_publishable_9GR7ip0UAe87rNeGsVM91g_1V3Yjepn"   // publishable: safe in the page, opens nothing on its own
};
