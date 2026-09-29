import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card mx-auto max-w-lg p-8 text-center">
      <div className="text-4xl font-semibold muted">404</div>
      <h1 className="mt-2 text-lg font-semibold">This page does not exist</h1>
      <p className="mt-1 text-sm muted">The room, finding or researcher you are looking for may have a different link.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Link href="/" className="btn btn-primary">Browse security rooms</Link>
        <Link href="/dashboard" className="btn">Your dashboard</Link>
      </div>
    </div>
  );
}
