var arcsavvy = require('./main.js');
var cp = require('child_process');
var fs = require('fs');
var _ = require('underscore');
var nb_states = 8;

if( process.argv[2]=='index1' || process.argv[2]==undefined || process.argv[2]=='all' ) {
// test indexing exploration functions
console.log('TEST explore_recursive');
explore_recursive('tests', function(n,t,f,c) {
  console.log(t,n);
});

console.log('TEST get_element');
console.log(get_element('./tests/state0/description.txt', 'description.txt'));
console.log(get_element('./tests/state2/file2.txt', 'file2.txt'));
console.log(get_element('./tests/state7/subdir', 'subdir'));
console.log(get_element('./tests/state8/real-link', 'real-link'));
}

if( process.argv[2]=='index2' || process.argv[2]==undefined || process.argv[2]=='all' ) {
// test full indexing function
console.log('TEST construct_index');
console.log(construct_index(construct_file_index('./tests/state8')));
}

if( process.argv[2]=='changes1' || process.argv[2]==undefined || process.argv[2]=='all' ) {
// test change detection for one file
console.log('TEST compute_changes (one file)');
var fname = 'file2.txt';
console.log('===== tracking only '+fname+' =====')
for( var i=0; i<nb_states; ++i ) {
  var s = 'tests/state'+i, e = 'tests/state'+(i+1);
  console.log('***** '+s+' -> '+e+' *****');
  var start = construct_index(construct_file_index(s,'')),
      end = construct_file_index(e,'');
  if( end[fname] ) {
    compute_changes(start, end, end[fname]);
  } else if( start.files[fname] ) {
    compute_changes(start, end, start.files[fname]);
  } else {
    console.log('not present at all: '+fname)
  }
}
}

if( process.argv[2]=='changes2' || process.argv[2]==undefined || process.argv[2]=='all' ) {
// test change detection for all files in offline mode
console.log('TEST compute_changes (all offline)');
console.log("===== tracking all files (offline mode) =====")
for( var i=0; i<nb_states; ++i ) {
  var s = 'tests/state'+i, e = 'tests/state'+(i+1);
  console.log('***** '+s+' -> '+e+' *****');
  var start = construct_index(construct_file_index(s,'')),
      end = construct_file_index(e,'');
  compare_indexes(start,end);
}
}

if( process.argv[2]=='changes3' || process.argv[2]==undefined || process.argv[2]=='all' ) {
// test change detection for all files in online mode
console.log('TEST compute_changes (all online)');
console.log("===== tracking all files (online mode) =====")
var end_index;
for( var i=0; i<nb_states; ++i ) {
  var s = 'tests/state'+i, e = 'tests/state'+(i+1);
  console.log('***** '+s+' -> '+e+' *****');
  var start = construct_index(construct_file_index(s,''));
  end_index = compare_indexes(start,e);
}
console.log(end_index);
}

if( process.argv[2]=='loop' || process.argv[2]==undefined || process.argv[2]=='all' ) {
// test cycle: archive->check->restore
// clean the temp directory
cp.spawnSync('rm',['-rf','temp']);
cp.spawnSync('mkdir', ['temp']);

console.log('TEST snapshot_archive/check_archive/restore_archive');
for( var i=0; i<=nb_states; ++i ) {
  var s = 'tests/state'+i, arc = 'temp/archive', status, status_success;

  // create an archive snapshot
  console.log('***** creating archive snapshot '+s+' *****');
  snapshot_archive(arc, s);
  explore_recursive(arc, function(n,t,f,c) {
    console.log(t,n);
  });

  // check archive
  status = check_archive(arc, true);
  function and(x, y) { return x && y; }
  status_success = _.reduce(_.flatten(_.map(_.values(status), _.values)), and);
  if( status_success ) {
    console.log('Archive integrity is OK');
  } else {
    console.log(status);
    throw new Error('Archive integrity verification failed!');
  }

  // restore
  status = restore_archive(arc, 'temp/state'+i);
  console.log(status);
}
}
