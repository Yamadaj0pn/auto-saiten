"use client";

import { useState } from "react";

interface GradingResponse {
  student_answer: string;
  score: number;
  max_score: number;
  reasoning: string;
  comments: string;
  annotated_image: string;
  error?: string;
}

export default function Home() {
  const [answerFile, setAnswerFile] = useState<File | null>(null);
  const [criteriaFile, setCriteriaFile] = useState<File | null>(null);
  const [answerPreview, setAnswerPreview] = useState<string | null>(null);
  const [criteriaPreview, setCriteriaPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GradingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(
    file: File | null,
    setFile: (f: File | null) => void,
    setPreview: (p: string | null) => void,
  ) {
    setFile(file);
    if (file && file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setPreview(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!answerFile || !criteriaFile) {
      setError("答案画像と採点基準の両方をアップロードしてください。");
      return;
    }

    setError(null);
    setResult(null);
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("answer", answerFile);
      formData.append("criteria", criteriaFile);

      const response = await fetch("/api/grade", {
        method: "POST",
        body: formData,
      });

      const data: GradingResponse = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "採点に失敗しました。");
      }

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "予期しないエラーが発生しました。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">手書き答案 自動採点</h1>
        <p className="text-slate-600 mt-2">
          採点基準と生徒の答案画像をアップロードすると、Gemini Vision が採点して点数を画像に書き込みます。
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 space-y-6"
      >
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            採点基準(画像 / .txt / .md)
          </label>
          <input
            type="file"
            accept="image/*,.txt,.md,text/plain,text/markdown"
            onChange={(e) =>
              handleFileChange(
                e.target.files?.[0] ?? null,
                setCriteriaFile,
                setCriteriaPreview,
              )
            }
            className="block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
          />
          {criteriaPreview && (
            <img
              src={criteriaPreview}
              alt="採点基準プレビュー"
              className="mt-3 max-h-48 rounded border border-slate-200"
            />
          )}
          {criteriaFile && !criteriaPreview && (
            <p className="mt-2 text-sm text-slate-500">📄 {criteriaFile.name}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            生徒の答案(画像)
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) =>
              handleFileChange(
                e.target.files?.[0] ?? null,
                setAnswerFile,
                setAnswerPreview,
              )
            }
            className="block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
          />
          {answerPreview && (
            <img
              src={answerPreview}
              alt="答案プレビュー"
              className="mt-3 max-h-64 rounded border border-slate-200"
            />
          )}
        </div>

        <button
          type="submit"
          disabled={loading || !answerFile || !criteriaFile}
          className="w-full bg-slate-900 text-white py-3 px-4 rounded-md font-semibold hover:bg-slate-800 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "採点中..." : "採点する"}
        </button>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-800">
            {error}
          </div>
        )}
      </form>

      {result && (
        <section className="mt-8 bg-white rounded-lg shadow-sm border border-slate-200 p-6 space-y-6">
          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">採点結果</h2>
            <p className="text-3xl font-bold text-red-600">
              {result.score}{" "}
              <span className="text-xl text-slate-500">/ {result.max_score}</span>
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-slate-700 mb-2">採点済み画像</h3>
            <img
              src={result.annotated_image}
              alt="採点済み答案"
              className="max-w-full rounded border border-slate-200"
            />
            <a
              href={result.annotated_image}
              download="graded.jpg"
              className="inline-block mt-2 text-sm text-blue-600 hover:underline"
            >
              ⬇ 画像をダウンロード
            </a>
          </div>

          <div>
            <h3 className="font-semibold text-slate-700 mb-2">答案(OCR)</h3>
            <p className="text-sm text-slate-700 bg-slate-50 p-3 rounded whitespace-pre-wrap">
              {result.student_answer}
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-slate-700 mb-2">採点の根拠</h3>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">
              {result.reasoning}
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-slate-700 mb-2">生徒へのコメント</h3>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">
              {result.comments}
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
