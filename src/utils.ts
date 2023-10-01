export function simplifiedRepos(repos: any[]) {
  return repos.map((repo) => {
    return {
      id: repo.id,
      name: repo.name,
      description: repo.description,
      url: repo.html_url,
      language: repo.language,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      watchers: repo.watchers_count,
      createdAt: repo.created_at,
      updatedAt: repo.updated_at,
      topics: repo.topics,
    };
  });
}
