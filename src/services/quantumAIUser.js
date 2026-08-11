import { ensureSystemUser } from './systemUsers.js';

export const QUANTUM_AI_USERNAME = 'QuantumAI';
export const QUANTUM_AI_EMAIL = 'quantumai@system.quantumchat';

export async function ensureQuantumAIUser() {
  return ensureSystemUser({
    systemRole: 'quantum_ai',
    username: QUANTUM_AI_USERNAME,
    email: QUANTUM_AI_EMAIL,
    displayName: 'QuantumAI',
  });
}
