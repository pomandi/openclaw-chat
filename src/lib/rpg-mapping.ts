// RPG class/color/icon mapping for agents

import type { AgentStatus } from './types-arena';

export interface RPGClass {
  className: string;
  icon: string;
  color: string;
  description: string;
}

export const RPG_CLASSES: Record<string, RPGClass> = {
  'main':               { className: 'King',           icon: '👑', color: '#FFD700', description: 'Supreme ruler of all agents' },
  'coding-agent':       { className: 'Mage',           icon: '🧙', color: '#3B82F6', description: 'Master of arcane code spells' },
  'security':           { className: 'Warrior',        icon: '⚔️', color: '#DC2626', description: 'Guardian of the realm\'s defenses' },
  'customer-relations': { className: 'Healer',         icon: '💚', color: '#EC4899', description: 'Mends wounds between merchants and patrons' },
  'seo-agent':          { className: 'Ranger',         icon: '🏹', color: '#14B8A6', description: 'Scouts the vast search wilderness' },
  'pomamarketing':      { className: 'Bard',           icon: '📯', color: '#22C55E', description: 'Spreads tales of glory across the land' },
  'personal-assistant': { className: 'Paladin',        icon: '🛡️', color: '#F8FAFC', description: 'Devoted protector of the royal calendar' },
  'ops-monitor':        { className: 'Oracle',         icon: '👁️', color: '#FF4444', description: 'Sees all that transpires in the systems' },
  'qa-tester':          { className: 'Scout',          icon: '🔍', color: '#EAB308', description: 'Hunts bugs in the darkest corners' },
  'hr':                 { className: 'Scribe',         icon: '📜', color: '#8B5CF6', description: 'Keeper of records and team wisdom' },
  'vision':             { className: 'Artificer',      icon: '🎨', color: '#06B6D4', description: 'Crafts visual wonders from raw data' },
  'ads-merchant':       { className: 'Merchant',       icon: '💰', color: '#F59E0B', description: 'Trades in the marketplace of ads' },
  'investor':           { className: 'Treasurer',      icon: '📈', color: '#10B981', description: 'Guards the kingdom\'s coffers' },
  'product-upload':     { className: 'Porter',         icon: '📦', color: '#84CC16', description: 'Hauls goods to the digital shelves' },
  'fatura-collector':   { className: 'Tax Collector',  icon: '🧾', color: '#F97316', description: 'Extracts tribute from every transaction' },
  'mtm-tedarik':        { className: 'Quartermaster',  icon: '🔗', color: '#A16207', description: 'Manages the supply chain' },
  'gatekeeper':         { className: 'Gatekeeper',     icon: '🚪', color: '#64748B', description: 'Controls who enters the realm' },
};

const DEFAULT_CLASS: RPGClass = {
  className: 'Adventurer',
  icon: '🤖',
  color: '#94A3B8',
  description: 'A wandering agent of unknown origin',
};

export function getRPGClass(agentId: string): RPGClass {
  return RPG_CLASSES[agentId] || DEFAULT_CLASS;
}

// Status → CSS animation class mapping
export function getStatusAnimation(status: AgentStatus): string {
  switch (status) {
    case 'thinking': return 'animate-pulse';
    case 'working':  return 'arena-glow';
    case 'error':    return 'arena-error-flash';
    case 'idle':     return 'opacity-70';
    case 'offline':  return 'opacity-40 grayscale';
    default:         return '';
  }
}

export function getStatusLabel(status: AgentStatus): string {
  switch (status) {
    case 'thinking': return 'Thinking...';
    case 'working':  return 'Working';
    case 'error':    return 'Error!';
    case 'idle':     return 'Idle';
    case 'offline':  return 'Offline';
    default:         return status;
  }
}

export function getStatusColor(status: AgentStatus): string {
  switch (status) {
    case 'thinking': return '#FBBF24';
    case 'working':  return '#22C55E';
    case 'error':    return '#EF4444';
    case 'idle':     return '#6B7280';
    case 'offline':  return '#374151';
    default:         return '#6B7280';
  }
}

// Token count → HP ratio (0-1)
export function calculateHP(totalTokens: number, maxTokens: number): number {
  if (maxTokens <= 0) return 0;
  return Math.min(1, totalTokens / maxTokens);
}

// Token count → MP ratio (0-1) = remaining capacity
export function calculateMP(totalTokens: number, maxTokens: number): number {
  if (maxTokens <= 0) return 0;
  return Math.max(0, 1 - totalTokens / maxTokens);
}

// HP bar color based on usage
export function getHPColor(hp: number): string {
  if (hp < 0.5) return '#22C55E';   // green - healthy
  if (hp < 0.75) return '#EAB308';  // yellow - caution
  return '#EF4444';                   // red - danger
}

// MP bar color
export function getMPColor(mp: number): string {
  if (mp > 0.5) return '#3B82F6';    // blue - plenty
  if (mp > 0.25) return '#8B5CF6';   // purple - moderate
  return '#6B7280';                    // gray - low
}

// XP → Level calculation (logarithmic)
export function calculateLevel(totalXP: number): number {
  if (totalXP <= 0) return 1;
  return Math.floor(Math.log2(totalXP / 1000) + 1);
}

// RPG-style event message formatter
export function formatArenaEvent(agentId: string, eventType: string, detail?: string): string {
  const rpg = getRPGClass(agentId);
  switch (eventType) {
    case 'tool_call':
      return `${rpg.icon} ${rpg.className} cast \`${detail}\` spell`;
    case 'chat':
      return `${rpg.icon} ${rpg.className} speaks: "${detail}"`;
    case 'quest_start':
      return `${rpg.icon} ${rpg.className} embarks on quest: ${detail}`;
    case 'quest_complete':
      return `${rpg.icon} ${rpg.className} completed quest: ${detail}`;
    case 'quest_fail':
      return `${rpg.icon} ${rpg.className} failed quest: ${detail}`;
    case 'status_change':
      return `${rpg.icon} ${rpg.className} is now ${detail}`;
    default:
      return `${rpg.icon} ${rpg.className}: ${detail || eventType}`;
  }
}

// Max tokens for context window (200K default)
export const MAX_CONTEXT_TOKENS = 200_000;
