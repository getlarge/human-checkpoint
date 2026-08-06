class HumanCheckpointSessionStrategy {
  constructor(_options, verify) {
    this.name = 'human-checkpoint-session';
    this.verify = verify;
  }

  authenticate(request) {
    if (!request.humanCheckpointSession) {
      this.error(new Error('Human Checkpoint session required'));
      return;
    }
    this.verify({ username: 'human-checkpoint-team-member' }, (error, user) => {
      if (error) {
        this.error(error);
      } else if (!user) {
        this.fail('Human Checkpoint team access required', 403);
      } else {
        this.success(user);
      }
    });
  }
}

function createReadOnlyNodeRedAdminAuth() {
  return {
    type: 'strategy',
    sessionExpiryTime: 3600,
    strategy: {
      name: 'human-checkpoint-session',
      label: 'Continue with Human Checkpoint',
      icon: 'fa-lock',
      autoLogin: true,
      strategy: HumanCheckpointSessionStrategy,
      options: {
        verify: (_profile, done) =>
          done(null, { username: 'human-checkpoint-team-member' }),
      },
    },
    users: async (username) =>
      username === 'human-checkpoint-team-member'
        ? { username, permissions: 'read' }
        : null,
  };
}

module.exports = {
  HumanCheckpointSessionStrategy,
  createReadOnlyNodeRedAdminAuth,
};
