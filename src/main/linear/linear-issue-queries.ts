export const LINEAR_ISSUE_NODE_FIELDS = `
  id
  identifier
  title
  branchName
  description
  url
  dueDate
  priority
  estimate
  updatedAt
  labelIds
  state {
    name
    type
    color
  }
  team {
    id
    name
    key
  }
  assignee {
    id
    displayName
    avatarUrl
  }
  labels(first: 50) {
    nodes {
      id
      name
    }
  }
`

export const SEARCH_ISSUES_QUERY = `
  query OrcaLinearIssueSearch($term: String!, $first: Int) {
    searchIssues(term: $term, first: $first) {
      nodes {
        ${LINEAR_ISSUE_NODE_FIELDS}
      }
    }
  }
`

export const ALL_ISSUES_QUERY = `
  query OrcaLinearIssues(
    $first: Int,
    $after: String,
    $filter: IssueFilter,
    $orderBy: PaginationOrderBy
  ) {
    issues(first: $first, after: $after, filter: $filter, orderBy: $orderBy) {
      nodes {
        ${LINEAR_ISSUE_NODE_FIELDS}
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`

export const VIEWER_ASSIGNED_ISSUES_QUERY = `
  query OrcaLinearViewerAssignedIssues(
    $first: Int,
    $after: String,
    $filter: IssueFilter,
    $orderBy: PaginationOrderBy
  ) {
    viewer {
      assignedIssues(first: $first, after: $after, filter: $filter, orderBy: $orderBy) {
        nodes {
          ${LINEAR_ISSUE_NODE_FIELDS}
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`

export const VIEWER_CREATED_ISSUES_QUERY = `
  query OrcaLinearViewerCreatedIssues(
    $first: Int,
    $after: String,
    $filter: IssueFilter,
    $orderBy: PaginationOrderBy
  ) {
    viewer {
      createdIssues(first: $first, after: $after, filter: $filter, orderBy: $orderBy) {
        nodes {
          ${LINEAR_ISSUE_NODE_FIELDS}
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`

export const AGENT_ISSUE_WRITE_FIELDS = `
  id
  identifier
  title
  description
  url
  team { id key name }
  state { id name }
  parent { id identifier }
  project { id name }
  assignee { id displayName }
  priority
  estimate
  dueDate
  labelIds
  labels(first: 50) { nodes { id name } }
`

export const ISSUE_BY_UUID_QUERY = `
  query OrcaLinearIssueByUuid($id: String!) {
    issue(id: $id) {
      ${AGENT_ISSUE_WRITE_FIELDS}
    }
  }
`

export const COMMENT_BY_UUID_QUERY = `
  query OrcaLinearCommentByUuid($id: String!) {
    comment(id: $id) {
      id
      url
      body
      parent { id }
      issue { id identifier url }
    }
  }
`

export const ATTACHMENT_BY_UUID_QUERY = `
  query OrcaLinearAttachmentByUuid($id: String!) {
    attachment(id: $id) {
      id
      title
      url
      issue { id identifier url }
    }
  }
`

// Keep comment authors in the issue request to avoid one SDK user query per comment.
export const ISSUE_COMMENTS_QUERY = `
  query OrcaLinearIssueComments($id: String!) {
    issue(id: $id) {
      comments(first: 50) {
        nodes {
          id
          body
          createdAt
          user {
            displayName
            avatarUrl
          }
        }
      }
    }
  }
`
