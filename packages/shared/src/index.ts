export type User = {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
};

export type Team = {
  id: string;
  name: string;
  ownerId: string;
  createdAt: Date;
};
