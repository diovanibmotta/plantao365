export { TEAM_HEADER, requireTeam, teamMiddleware } from './middleware.js';
export { createTeamsRouter } from './router.js';
export {
  TeamsError,
  createTeam,
  listAccessibleTeams,
  setTeamMemberTx,
  type TeamDto,
} from './service.js';
