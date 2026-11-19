import { Router } from 'express';
import * as compController from '../controllers/competition.controller.js';
import * as certificateLogo from '../controllers/certificateLogo.controller.js';
import { requireRole } from '../middlewares/auth.js';

const router = Router();

// Gym logo printed on certificates next to the VIRTEX logo (must be above '/:id')
router.get('/certificate-logo', requireRole('owner', 'manager', 'trainer'), certificateLogo.getLogo);
router.put('/certificate-logo', requireRole('owner', 'manager'), certificateLogo.setLogo);
router.delete('/certificate-logo', requireRole('owner', 'manager'), certificateLogo.removeLogo);

// Competitions & Challenges
router.get('/', requireRole('owner', 'manager', 'trainer'), compController.getCompetitions);
router.get('/kpis/summary', requireRole('owner', 'manager', 'trainer'), compController.getCompetitionModuleKpis);
router.get('/:id', requireRole('owner', 'manager', 'trainer'), compController.getCompetitionById);
router.post('/', requireRole('owner', 'manager', 'trainer'), compController.createCompetition);
router.patch('/:id/status', requireRole('owner', 'manager', 'trainer'), compController.updateCompetitionStatus);
// Edit / delete a competition (deleting also removes its registrations and certificates; a copy goes to the audit log)
router.put('/:id', requireRole('owner', 'manager'), compController.updateCompetition);
router.delete('/:id', requireRole('owner', 'manager'), compController.deleteCompetition);

// Leaderboard
router.get('/:competitionId/leaderboard', requireRole('owner', 'manager', 'trainer'), compController.getLeaderboard);

// Participant Registrations & Scoring
router.get('/participants/all', requireRole('owner', 'manager', 'trainer'), compController.getParticipants);
router.post('/participants', requireRole('owner', 'manager', 'trainer'), compController.registerParticipant);
router.post('/participants/:participantId/score', requireRole('owner', 'manager', 'trainer'), compController.submitScore);

// Awards & Certificates
router.get('/certificates/all', requireRole('owner', 'manager', 'trainer'), compController.getCertificates);
router.post('/certificates', requireRole('owner', 'manager', 'trainer'), compController.issueCertificate);

export default router;

