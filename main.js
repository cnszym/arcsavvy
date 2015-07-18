var cp = require('child_process');
var fs = require('fs');
var path = require('path');
var _ = require('underscore');

/***** Indexing *****/

/**
* Recursively traverse files and directories invoking the callback
* function on each element found.
*/
explore_recursive = function(dir, callback, context, base) {
  if( base==undefined ) base = path.basename(dir);
  _.map(fs.readdirSync(dir), function(file) {
    var f = path.join(dir, file); // this is the real file name on disk
    var n = path.join(base, file); // this is the file name in the archive
    var s = fs.lstatSync(f);
    if( s.isDirectory() ) {
      context = callback(n, 'D', f, context);
      explore_recursive(f, callback, context, n);
    } else if( s.isFile() ) {
      context = callback(n, 'F', f, context);
    } else {
      // TODO: handle symbolic links and special files
      console.error("Error: File type not supported, ignoring: "+n);
    }
  });
  return context;
};

/**
* Return file stats (see return statement).
*/
get_element = function(file, full_name) {
  if( full_name==undefined ) full_name = file;
  var s = fs.lstatSync(file), hash;
  if( s.isFile() ) {
    // hashes are only computed for files
    // FIXME: make a better helper function
    var h = cp.spawnSync('md5',['-r',file]);
    if( h.status!=0 ) {
      throw new Error(file+': '+h.error);
    }
    hash = String(h.stdout).split(' ')[0];
  }
  return {
    full_name: full_name,
    base_name: path.basename(file),
    type: (s.isDirectory()?'D':(s.isSymbolicLink()?'L':(s.isFile()?'F':'O'))),
    size: s.size,
    mode: s.mode,
    hash: hash,
  };
};

/**
* Construct an index of files for the specified directory.
*/
construct_file_index = function(dir, base) {
  return explore_recursive(dir, function(name, type, file, index) {
    index[name] = get_element(file, name);
    return index;
  }, {}, base);
};

/**
* Construct an index of objects from the specified file index.
*/
construct_object_index = function(file_index) {
  var object_index = {};
  _.map(_.values(file_index), function(element) {
    if( element.type=='F')
    {
      // hashes are only computed for files
      if( _.has(object_index, element.hash) ) {
        object_index[element.hash].refs += 1;
        object_index[element.hash].files.push(element);
      } else {
        object_index[element.hash] = {
          refs: 1,
          files: [element],
        };
      }
    }
  });
  return object_index;
}

/**
* Construct a full index of files and objects.
*/
construct_index = function(file_index) {
  return {
    files: file_index,
    objects: construct_object_index(file_index)
  };
};

/***** Handling changes *****/

/**
* Dummy callback function which only print information to stdout.
*/
var dummy_callback = {
  new: function(new_element) { console.info('new: '+new_element.full_name); },
  rename: function(old_element,new_element) { console.info('rename: '+old_element.full_name+'->'+new_element.full_name); },
  copy: function(old_element,new_element) { console.info('copy: '+old_element.full_name+'->'+new_element.full_name); },
  modify: function(old_element,new_element) { console.info('modify: '+new_element.full_name+' ('+old_element.size+' bytes -> '+new_element.size+' bytes)'); },
  modify_instance: function(old_element,new_element) { console.info('modify one instance: '+new_element.full_name+' ('+old_element.size+' bytes -> '+new_element.size+' bytes)'); },
  chmod: function(old_element,new_element) { console.info('chmod: '+new_element.full_name+' ('+old_element.mode+'->'+new_element.mode+')'); },
  unchanged: function(old_element,new_element) { console.info('no change: '+new_element.full_name); },
  delete: function(old_element) { console.info('delete: '+old_element.full_name); },
  delete_instance: function(old_element) { console.info('delete one instance: '+old_element.full_name); },
};

/**
* Detect changes and launch the appropriate callback actions.
* This is the core function of arcsavvy!
*/
compute_changes = function(start_index, end_file_index, end_element, callback) {
  if( callback==undefined ) callback = dummy_callback;
  if( start_index.seen==undefined ) start_index.seen = {};

  var start_element = start_index.files[end_element.full_name];
  if( end_file_index && end_file_index[end_element.full_name]==undefined ) {
    // not found in end index: deleted or renamed?
    var end_index = construct_index(end_file_index);
    var end_element2 = end_index.objects[end_element.hash];
    if( end_element2==undefined ) {
      // hash not found: deleted
      callback.delete(end_element);
    } else {
      // hash found: renamed
      if( end_element2.refs==1 ) {
        callback.rename(end_element,end_element2.files[0]);
      } else {
        console.warn("Warning: Ambiguous rename, I consider the file as being copy of: "+end_element2.files[0].full_name);
        callback.rename(end_element,end_element2.files[0]);
      }
    }
  } else if( start_element==undefined ) {
    // file not found in start index: new, renamed or copied?
    start_element = start_index.objects[end_element.hash];
    if( start_element==undefined ) {
      // hash not found: new
      callback.new(end_element);
    } else {
      // hash found: renamed or copied?
      if( start_element.refs==1 ) {
        start_element = start_element.files[0];
        // if end_file_index is available, then forward detection is possible
        // so we can directly rename the file, otherwise we will have to
        // first make a copy of it, and delete it later
        if( end_file_index && !_.has(end_file_index, start_element.full_name) ) {
          // file is not present anymore: renamed
          start_index.seen[start_element.hash] = true;
          callback.rename(start_element,end_element);
        } else {
          // file is still there: copied
          callback.copy(start_element,end_element);
        }
      } else {
        // FIXME: what is the appropriate behavior?
        // FIXME: can it be a rename? can end_file_index help us find out?

        // there are multiple references, consider as new and emit a warning
        // console.log("Warning: Ambiguous rename, I consider the file as being new")
        // callback.new(end_element);

        // there are multiple references, consider arbitrarily as a copy of first one
        start_element = start_element.files[0];
        console.warn("Warning: Ambiguous copy, I consider the file as being copy of: "+start_element.full_name);
        callback.copy(start_element,end_element);
      }
    }
  } else {
    // file found
    start_element.seen = true;
    if( start_element.size!=end_element.size || start_element.hash!=end_element.hash ) {
      // different hash or size
      var start_hash = start_index.objects[start_element.hash];
      if( start_hash.refs==1 ) {
        callback.modify(start_element,end_element);
      } else {
        callback.modify_instance(start_element,end_element);
      }
    } else if( start_element.mode!=end_element.mode ) {
      // different mode
      callback.chmod(start_element,end_element);
    } else {
      // no change detected
      callback.unchanged(start_element,end_element);
    }
  }
  return start_index;
};

/**
* Compare indexes and launch the appropriate callback actions.
* Offline = end index is already available
* Online  = end index is computed on the fly
*/
compare_indexes = function(start_index, index_or_dir, callback) {
  if( callback==undefined ) callback = dummy_callback;
  var end_file_index;

  // look for new files, renamed files and changed files
  if( index_or_dir instanceof Object )
  {
    // offline mode: end index is already available
    // iterate over end_file_index
    end_file_index = index_or_dir;
    _.map( _.values(end_file_index), function(end_element) {
      start_index = compute_changes(start_index, end_file_index, end_element, callback);
    });
  }
  else
  {
    // online mode: end index is computed on the fly
    // recursively explore dir
    var dir = index_or_dir;
    end_file_index = explore_recursive(dir, function(name, type, file, index) {
      index[name] = get_element(file, name);
      start_index = compute_changes(start_index, undefined, index[name], callback);
      return index;
    }, {}, '');
  }

  // end index is now available
  var end_index = construct_index(end_file_index);

  // look for deleted (= unseen) files
  _.map( _.values(start_index.files), function(start_element) {
    if( !_.has(start_index.seen, start_element.hash) ) {
      var end_element = end_index.objects[start_element.hash];
      if( end_element==undefined ) {
        callback.delete(start_element);
      } else {
        callback.delete_instance(start_element);
      }
    }
  });

  return end_index;
};

/***** Archive/Check/Restore *****/

/**
* Base functions for manipulating plain obejct archives, to be extended to
* support more elaborate archive types: with compression, packing, encryption,
* remote access, etc.
* This is the key class of arcsavvy.
*/
var plain_object_callback = function(archive_dir, files_dir) { return {
  // attributes
  archive_dir: archive_dir,
  object_dir: path.join(archive_dir, 'objects'),
  files_dir: files_dir,

  // archive manipulation
  init: function(index) {
    // create missing directories
    if( !fs.existsSync(this.archive_dir) ) {
      fs.mkdirSync(this.archive_dir);
    }
    if( !fs.existsSync(this.object_dir) ) {
      fs.mkdirSync(this.object_dir);
    }
  },
  readIndex: function(index) {
    if( index==undefined ) index='index.json';
    var index_file = path.join(this.archive_dir, index);
    if( fs.existsSync(index_file) ) {
      file_index = JSON.parse(fs.readFileSync(index_file));
    } else {
      file_index = { };
    }
    return construct_index(file_index);
  },
  pushSnapshot: function(new_index) {
    var snap = (new Date()).toJSON();
    var snap_file = path.join(this.archive_dir,'index-snapshot-'+snap+'.json');
    var index_file = path.join(this.archive_dir,'index.json');
    fs.writeFileSync(snap_file, JSON.stringify(new_index.files), 'utf-8');
    // FIXME: better helper function
    cp.spawnSync('cp', [snap_file,index_file]);
  },
  listSnapshots: function() {
    var snapshots = [];
    _.map(fs.readdirSync(this.archive_dir), function(f) {
      if( /^index-snapshot.*\.json$/.test(f) ) {
        snapshots.push(f);
      }
    });
    snapshots.push('index.json'); // always check index.json last
    return snapshots;
  },
  addObject: function(new_element) {
    if( new_element.type=='F' ) {
      var fpath = path.join(this.files_dir, new_element.full_name);
      var opath = path.join(this.object_dir, new_element.hash);
      if( fs.existsSync(opath) ) {
        // FIXME: handle collisions
        console.error('Error: Collision detected, ignoring file: '+new_element.full_name+' '+new_element.hash);
      } else {
        // FIXME: better helper function
        cp.spawnSync('cp', [fpath,opath]);
      }
    }
  },
  rmObject: function(old_element) {
    if( old_element.type=='F' ) {
      var opath = path.join(this.object_dir, old_element.hash);
      // FIXME: better helper function
      cp.spawnSync('rm', [opath]);
    }
  },
  checkObject: function(element, deep) {
    if( element.type=='F' ) {
      var ofile = path.join(this.object_dir, element.hash);
      if( !fs.existsSync(ofile) ) {
        return 'Archive is corrupt: Missing object '+element.hash+' / '+element.full_name;
      }
      if( deep ) {
        var s = get_element(ofile);
        if( s.hash!=element.hash ) {
          return 'Archive is corrupt: Hash mismatch for object '+element.hash+' / '+element.full_name;
        }
        if( s.size!=element.size ) {
          return 'Archive is corrupt: Size mismatch for object '+element.hash+' / '+element.full_name;
        }
      }
    }
    return true; // all checks succeeded
  },

  // restore functions
  restoreFile: function(element) {
    var fpath = path.join(this.files_dir, element.full_name);
    var opath = path.join(this.object_dir, element.hash);
    cp.spawnSync('cp', [opath,fpath]);
  },
  restoreDirectory: function(element) {
    var fpath = path.join(this.files_dir, element.full_name);
    fs.mkdirSync(fpath);
  },
  restoreMode: function(element) {
    var fpath = path.join(this.files_dir, element.full_name);
    fs.chmodSync(fpath, element.mode);
  },
  restore: function(archive_index) {
    // create the target directory
    if( fs.existsSync(this.files_dir) ) {
      throw new Error('Target directory already exists, will not overwrite: '+files_dir);
    }
    fs.mkdirSync(this.files_dir);

    // restore the archive contents
    var status = { };
    for( var o in archive_index.files ) {
      var element = archive_index.files[o];
      if( element.type=='F' ) {
        this.restoreFile(element);
      } else if( element.type=='D' ) {
        this.restoreDirectory(element);
      } else {
        throw new Error("unsupported type: "+element.type);
      }
      this.restoreMode(element);
      status[element.full_name] = true;
    }
    return status;
  },

  // callback function
  new: function(new_element) {
    // add the new object
    this.addObject(new_element);
  },
  rename: function(old_element,new_element) {
    // no action required: object is already present and still in use
    // TODO: possible full check for changes
  },
  copy: function(old_element,new_element) {
    // no action required: the copy file will use the already existing object
    // TODO: possible full check for changes
  },
  modify: function(old_element,new_element) {
    // add the modified version to the repository
    this.addObject(new_element);
  },
  modify_instance: function(old_element,new_element) {
    // add the modified version to the repository
    this.addObject(new_element);
  },
  chmod: function(old_element,new_element) {
    // no action required: object is already present and still in use
    // TODO: possible full check for changes
  },
  unchanged: function(old_element,new_element) {
    // nothing to do: element has not changed
    // TODO: possible full check for changes
  },
  delete: function(old_element) {
    // no action required: object is kept and will be removed later if nedded
  },
  delete_instance: function(old_element) {
    // no action required: object is still in use
  },
};};

/**
* Add a new snapshot to the archive repository using the designated callback
* manipulation functions.
*/
snapshot_archive = function(archive_dir, files_dir, callback) {
  if( callback==undefined ) callback = plain_object_callback;
  var archive, archive_index, new_index;

  // initialize the archive and read the index
  archive = new callback(archive_dir, files_dir);
  archive.init();
  archive_index = archive.readIndex();

  // Take a snapshot:
  //   1. update the archive with new objects
  //   2. push the latest snapshot
  //   3. remove objects not needed anymore
  new_index = compare_indexes(archive_index, files_dir, archive);
  archive.pushSnapshot(new_index);
  // TODO: remove objects not needed anymore

  return new_index;
};

/**
* Check archive.
*/
check_archive = function(archive_dir, deep, callback)
{
  if( deep==undefined ) deep=false;
  if( callback==undefined ) callback = plain_object_callback;
  var archive, archive_index, archive_check;

  // initialize the archive and read the index
  archive = new callback(archive_dir, undefined);
  archive.init();

  // check all snapshots
  archive_check = { };
  _.map( archive.listSnapshots(), function(snapshot) {
    archive_index = archive.readIndex(snapshot);
    archive_check[snapshot] = _.mapObject(archive_index.files, function(element, name) {
      return archive.checkObject(element, deep);
    });
  });
  return archive_check;
};

/**
* Restore the archive from scratch
*/
restore_archive = function(archive_dir, target_dir, index_name, callback)
{
  if( callback==undefined ) callback = plain_object_callback;
  var archive, archive_index, status;

  // initialize the archive and read the index
  archive = new callback(archive_dir, target_dir);
  archive.init();
  archive_index = archive.readIndex(index_name);

  // restore the archive
  status = archive.restore(archive_index);

  return status;
};


/* TODO: handle collisions */
/* TODO: forget history */
/* TODO: unit tests */
/* TODO: subdirectories */
/* TODO: command line tool */
/* TODO: fail on error/warning/... */
/* TODO: npm package */
/* TODO: documentation */
/* TODO: split hashes for large files */
/* TODO: detect collisions */
/* TODO: symlinks */
/* TODO: archive fast mode (using hashes) */
/* TODO: archive full mode */
/* TODO: check archive */
/* TODO: restore archive */
/* TODO: archive snapshots */
/* TODO: archive packing */
/* TODO: archive compression */
/* TODO: archive encryption */
/* TODO: archive to remote via SSH */
/* TODO: archive manipulation (e.g. shell?) */
