export interface StarterFile {
  relPath: string;
  headings: string[];
}

export const STARTER_FILES: StarterFile[] = [
  { relPath: 'context/projectBrief.md', headings: ['Overview'] },
  { relPath: 'context/objectives.md', headings: ['Objectives'] },
  { relPath: 'context/activeContext.md', headings: ['Current Focus'] },
  { relPath: 'context/decisions.md', headings: ['Decisions Log'] },
  { relPath: 'context/progress.md', headings: ['Status'] },
  { relPath: 'context/learnings.md', headings: ['Learnings'] },
  { relPath: 'technical/architecture.md', headings: ['Overview', 'Components', 'Data Flow', 'Integrations'] },
  { relPath: 'technical/techContext.md', headings: ['Stack', 'Conventions', 'Environment'] },
  { relPath: 'technical/patterns.md', headings: ['Design Patterns', 'Anti-Patterns'] },
  { relPath: 'technical/integrations.md', headings: ['External Services', 'Internal Dependencies'] },
  { relPath: 'technical/infrastructure.md', headings: ['Deployment', 'Hosting', 'CI/CD'] },
  { relPath: 'business/productContext.md', headings: ['Product Overview', 'Users', 'Value Proposition'] },
  { relPath: 'business/roadmap.md', headings: ['Now', 'Next', 'Later'] },
  { relPath: 'business/stakeholders.md', headings: ['Team', 'External Stakeholders'] },
  { relPath: 'business/marketContext.md', headings: ['Market Overview', 'Competitors'] },
  { relPath: 'research/findings.md', headings: ['Key Findings'] },
  { relPath: 'research/references.md', headings: ['Sources'] },
  { relPath: 'research/hypotheses.md', headings: ['Open Hypotheses'] }
];

// No headings — always fully overwritten by `update`, never section-addressed.
export const MENTAL_MODEL_STARTER = '_No sessions yet._\n';
