import type { Context, Namespace } from '@ory/permission-namespace-types';

class Team implements Namespace {
  related: {
    owners: (Agent | Human)[];
    managers: (Agent | Human)[];
    members: (Agent | Human)[];
  };

  permits = {
    manage: (ctx: Context) => this.related.owners.includes(ctx.subject),
    manage_members: (ctx: Context) =>
      this.related.owners.includes(ctx.subject) ||
      this.related.managers.includes(ctx.subject),
    write: (ctx: Context) =>
      this.related.owners.includes(ctx.subject) ||
      this.related.managers.includes(ctx.subject),
    manage_runtime: (ctx: Context) => this.permits.write(ctx),
    manage_credentials: (ctx: Context) => this.permits.write(ctx),
    access: (ctx: Context) =>
      this.related.owners.includes(ctx.subject) ||
      this.related.managers.includes(ctx.subject) ||
      this.related.members.includes(ctx.subject),
  };
}

class Group implements Namespace {
  related: { members: (Agent | Human)[]; parent: Team[] };
  permits = {
    manage: (ctx: Context) =>
      this.related.parent.traverse((team) => team.permits.manage_members(ctx)),
    access: (ctx: Context) => this.related.members.includes(ctx.subject),
  };
}

class Diary implements Namespace {
  related: {
    team: Team[];
    writers: (Agent | Human | SubjectSet<Group, 'members'>)[];
    managers: (Agent | Human | SubjectSet<Group, 'members'>)[];
  };
  permits = {
    read: (ctx: Context) =>
      this.related.writers.includes(ctx.subject) ||
      this.related.managers.includes(ctx.subject) ||
      this.related.team.traverse((team) => team.permits.access(ctx)),
    write: (ctx: Context) =>
      this.related.writers.includes(ctx.subject) ||
      this.related.managers.includes(ctx.subject) ||
      this.related.team.traverse((team) => team.permits.write(ctx)),
    propose: (ctx: Context) => this.permits.write(ctx),
    manage: (ctx: Context) =>
      this.related.managers.includes(ctx.subject) ||
      this.related.team.traverse((team) => team.permits.manage(ctx)),
    verify_claim: (ctx: Context) =>
      this.related.team.traverse((team) => team.permits.access(ctx)),
  };
}

class DiaryEntry implements Namespace {
  related: { parent: Diary[] };
  permits = {
    view: (ctx: Context) =>
      this.related.parent.traverse((diary) => diary.permits.read(ctx)),
    edit: (ctx: Context) =>
      this.related.parent.traverse((diary) => diary.permits.write(ctx)),
    delete: (ctx: Context) =>
      this.related.parent.traverse((diary) => diary.permits.write(ctx)),
  };
}

class ContextPack implements Namespace {
  related: { parent: Diary[] };
  permits = {
    read: (ctx: Context) =>
      this.related.parent.traverse((diary) => diary.permits.read(ctx)),
    write: (ctx: Context) =>
      this.related.parent.traverse((diary) => diary.permits.write(ctx)),
    manage: (ctx: Context) =>
      this.related.parent.traverse((diary) => diary.permits.manage(ctx)),
    verify_claim: (ctx: Context) =>
      this.related.parent.traverse((diary) => diary.permits.verify_claim(ctx)),
  };
}

class Task implements Namespace {
  related: { parent: Diary[]; claimant: Agent[] };
  permits = {
    view: (ctx: Context) =>
      this.related.parent.traverse((diary) => diary.permits.read(ctx)),
    edit_metadata: (ctx: Context) =>
      this.related.parent.traverse((diary) => diary.permits.write(ctx)),
    cancel: (ctx: Context) =>
      this.related.claimant.includes(ctx.subject) ||
      this.related.parent.traverse((diary) => diary.permits.write(ctx)),
    delete: (ctx: Context) =>
      this.related.parent.traverse((diary) => diary.permits.write(ctx)),
    force_delete: (ctx: Context) =>
      this.related.parent.traverse((diary) => diary.permits.manage(ctx)),
    claim: (ctx: Context) =>
      this.related.parent.traverse((diary) => diary.permits.write(ctx)),
    report: (ctx: Context) => this.related.claimant.includes(ctx.subject),
  };
}

class Agent implements Namespace {
  related: { self: Agent[] };
  permits = {
    act_as: (ctx: Context) => this.related.self.includes(ctx.subject),
  };
}

class Human implements Namespace {
  related: { self: Human[] };
  permits = {
    act_as: (ctx: Context) => this.related.self.includes(ctx.subject),
  };
}

class Tool implements Namespace {}
class ShellCommand implements Namespace {}

class RuntimePolicy implements Namespace {
  related: { command: ShellCommand[]; team: Team[]; tool: Tool[] };
  permits = {
    manage: (ctx: Context) =>
      this.related.team.traverse((team) => team.permits.manage_runtime(ctx)),
  };
}

class RuntimeProfile implements Namespace {
  related: { policies: RuntimePolicy[] };
}
