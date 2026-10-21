import type {Pool} from 'pg';
// pg removes the idle client itself. A listener prevents an unhandled error from
// terminating the server and avoids logging the client/connection credentials.
export function observePoolErrors(pool:Pick<Pool,'on'>,warn:(message:string)=>void=console.warn){
  pool.on('error',()=>warn('An idle database connection closed. The pool will reconnect on the next request.'));
}
