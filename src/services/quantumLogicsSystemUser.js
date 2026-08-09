import { ensureSystemUser } from './systemUsers.js';

export const QUANTUM_LOGICS_USERNAME = 'QuantumLogics';
export const QUANTUM_LOGICS_EMAIL = 'quantumlogics@system.quantumchat';

/**
 * Shared sender identity for messages pushed in through the partner
 * (API-key) integration — see routes/publicApiRoutes.js.
 */
export async function ensureQuantumLogicsSystemUser() {
  return ensureSystemUser({
    systemRole: 'quantum_logics',
    username: QUANTUM_LOGICS_USERNAME,
    email: QUANTUM_LOGICS_EMAIL,
    displayName: 'QuantumLogics',
  });
}
