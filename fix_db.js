import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = fs.existsSync(path.join(__dirname, '.env.local')) ? '.env.local' : '.env';
const envContent = fs.readFileSync(path.join(__dirname, envPath), 'utf8');

const env = {};
envContent.split('\n').forEach(line => {
  if (line && !line.startsWith('#')) {
    const parts = line.split('=');
    if (parts.length >= 2) {
      env[parts[0].trim()] = parts.slice(1).join('=').trim();
    }
  }
});

const supabaseUrl = env['VITE_SUPABASE_URL'];
const supabaseKey = env['VITE_SUPABASE_ANON_KEY'];

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('Fetching false records for call_confirmed...');
  const { data: c1, error: e1 } = await supabase
    .from('consultations')
    .update({ call_confirmed: null })
    .eq('call_confirmed', false);
    
  console.log('Fixed call_confirmed:', e1 || 'success');

  console.log('Fetching false records for received_reminder_messages...');
  // Only where status is NOT pendente because otherwise it was showing correctly before
  // Actually, let's clear all so they can be marked freely
  const { data: c3, error: e3 } = await supabase
    .from('consultations')
    .update({ received_reminder_messages: null })
    .eq('received_reminder_messages', false)

  console.log('Fixed received_reminder_messages:', e3 || 'success');
}

main();
