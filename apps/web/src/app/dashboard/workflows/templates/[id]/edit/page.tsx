import TemplateBuilder from "@/components/workflows/TemplateBuilder";

type PageProps = {
  params: {
    id: string;
  };
};

export default function EditWorkflowTemplatePage({ params }: PageProps) {
  return <TemplateBuilder mode="edit" templateID={params.id} />;
}
