export const TEAMS_PATH = '/teams';
export const TEAMS_NEW_PATH = `${TEAMS_PATH}/new`;
export const teamPath = (id: string) => `${TEAMS_PATH}/${id}`;
export const teamMembersPath = (id: string) => `${TEAMS_PATH}/${id}/members`;
