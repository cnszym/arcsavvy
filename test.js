var arcsavvy = require('./main.js');
var nb_states = 8;

explore_recursive('tests', function(n,t,f,c) {
  console.log(t,n);
});

console.log(get_element('./tests/state0/description.txt', 'state0/description.txt'));
console.log(construct_index(construct_file_index('./tests/state5')));

console.log("===== tracking only file2.txt =====")
for( var i=0; i<nb_states; ++i ) {
  var s = 'tests/state'+i, e = 'tests/state'+(i+1);
  console.log('***** '+s+' -> '+e+' *****');
  var start = construct_index(construct_file_index(s,'')),
      end = construct_file_index(e,'');
  if( end['file2.txt'] ) {
    compute_changes(start, end, end['file2.txt']);
  }
}

console.log("===== tracking all files (offline mode) =====")
for( var i=0; i<nb_states; ++i ) {
  var s = 'tests/state'+i, e = 'tests/state'+(i+1);
  console.log('***** '+s+' -> '+e+' *****');
  var start = construct_index(construct_file_index(s,'')),
      end = construct_file_index(e,'');
  compare_indexes(start,end);
}

console.log("===== tracking all files (online mode) =====")
var end_index;
for( var i=0; i<nb_states; ++i ) {
  var s = 'tests/state'+i, e = 'tests/state'+(i+1);
  console.log('***** '+s+' -> '+e+' *****');
  var start = construct_index(construct_file_index(s,''));
  end_index = compare_indexes(start,e);
}
console.log(end_index);
